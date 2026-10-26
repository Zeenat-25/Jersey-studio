import JSZip from 'jszip';
import { canonicalSize, getSleeveDimensions, sizeLabel } from './sizeChart';
import { containScale } from './sizingMath';

const safe = value => String(value ?? '').trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'UNKNOWN';
const validNumber = value => Number.isFinite(Number(value)) && Number(value) > 0;
const inches = (value, label) => {
  if (!validNumber(value)) throw new Error(`${label} must be greater than zero.`);
  return Number(value);
};

const sizeDimensions = (settings, size) => {
  const normalized = canonicalSize(size, settings.sizes);
  const found = settings.sizes[normalized];
  if (!found) throw new Error(`Missing page-size preset for jersey size ${size}. Add it in Properties → Layout.`);
  return [inches(found.width, `Width for size ${size}`), inches(found.height, `Height for size ${size}`)];
};

function cleanedPlayers(players, settings) {
  if (!players.length) throw new Error('Add or import at least one player.');
  return players.map((p, i) => {
    // Blank name and/or number are legitimate unpersonalized print orders.
    const qty = Number(p.quantity);
    if (!Number.isInteger(qty) || qty < 1) throw new Error(`Player ${i + 1} has an invalid quantity.`);
    const rawSize = String(p.size || '').trim();
    const size = canonicalSize(rawSize, settings.sizes);
    if (!size) throw new Error(`Player ${i + 1} (${p.name}) has unknown size '${rawSize}'. Choose a known code or add a custom preset.`);
    sizeDimensions(settings, size);
    return {
      ...p,
      name: String(p.name ?? '').trim().toLocaleUpperCase(),
      number: String(p.number ?? '').trim(),
      size,
      quantity: qty,
      sleeve: p.sleeve === 'Full' ? 'Full' : 'Half',
    };
  });
}

function addGrouped(map, key, entry, player) {
  if (map.has(key)) {
    map.get(key).quantity += player.quantity;
    return;
  }
  map.set(key, { ...entry, quantity: player.quantity });
}

export function createProductionJobs(players, settings, artwork) {
  const roster = cleanedPlayers(players, settings);
  if (!Object.keys(artwork).some(key => Boolean(artwork[key])) && settings.backPaperEnabled === false) {
    throw new Error('Upload artwork or enable back-name paper printing before exporting.');
  }

  const groups = new Map();

  for (const p of roster) {
    const dims = sizeDimensions(settings, p.size);
    if (artwork.front) {
      const key = `front|${p.size}|${settings.frontNumber ? p.number : ''}`;
      addGrouped(groups, key, {
        part: 'front', size: p.size, number: settings.frontNumber ? p.number : '', name: p.name, dims, src: artwork.front,
      }, p);
    }
    if (artwork.back) {
      const key = `back|${p.size}|${p.name}|${p.number}|${p.sleeve}`;
      addGrouped(groups, key, {
        part: 'back', size: p.size, name: p.name, number: p.number, sleeve: p.sleeve, dims, src: artwork.back,
      }, p);
    }
  }

  if (settings.backPaperEnabled !== false) {
    for (const p of roster) {
      if (!p.name && !p.number && !(settings.sponsorEnabled && settings.sponsors?.some(line => line.enabled !== false && String(line.text || '').trim()))) continue;
      const dims = sizeDimensions(settings, p.size);
      const key = `paper|${p.size}|${p.name}|${p.number}`;
      addGrouped(groups, key, {
        part: 'backPaper',
        size: p.size,
        name: p.name,
        number: p.number,
        sleeve: p.sleeve,
        dims,
        src: null,
      }, p);
    }
  }

  for (const sleeveType of ['Half', 'Full']) {
    for (const size of [...new Set(roster.filter(p => p.sleeve === sleeveType).map(p => p.size))]) {
      const matching = roster.filter(p => p.sleeve === sleeveType && p.size === size);
      if (!matching.length) continue;
      const qty = matching.reduce((sum, p) => sum + p.quantity, 0);
      const generic = artwork[sleeveType === 'Half' ? 'halfSleeve' : 'fullSleeve'];
      const sleeveDims = getSleeveDimensions(size, sleeveType, settings.sleeveChart);
      const leftSrc = artwork[`left${sleeveType}Sleeve`] || generic || artwork.leftSleeve || artwork[`right${sleeveType}Sleeve`];
      const rightSrc = artwork[`right${sleeveType}Sleeve`] || generic || artwork.rightSleeve || artwork[`left${sleeveType}Sleeve`];
      if (leftSrc) {
        groups.set(`sleeve|${sleeveType}|left|${size}`, {
          part: 'sleeve', side: 'left', sleeve: sleeveType, size, src: leftSrc,
          dims: [sleeveDims.width, sleeveDims.height], mirror: !artwork[`left${sleeveType}Sleeve`] && !artwork.leftSleeve && !generic && Boolean(artwork[`right${sleeveType}Sleeve`] || artwork.rightSleeve),
          quantity: qty,
        });
      }
      if (rightSrc) {
        groups.set(`sleeve|${sleeveType}|right|${size}`, {
          part: 'sleeve', side: 'right', sleeve: sleeveType, size, src: rightSrc,
          dims: [sleeveDims.width, sleeveDims.height], mirror: !artwork[`right${sleeveType}Sleeve`] && !artwork.rightSleeve && Boolean(artwork[`left${sleeveType}Sleeve`] || artwork.leftSleeve || generic),
          quantity: qty,
        });
      }
    }
  }

  if (artwork.collar) {
    groups.set('collar', {
      part: 'collar', src: artwork.collar,
      dims: [inches(settings.collarWidth, 'Collar width'), inches(settings.collarHeight, 'Collar height')],
      quantity: roster.reduce((sum, p) => sum + p.quantity, 0),
      collarType: settings.collarType,
    });
  }

  const jobs = Array.from(groups.values());
  if (!jobs.length) throw new Error('There are no matching artwork parts for this player list.');

  const usedNames = new Set();
  for (const job of jobs) {
    let basename;
    let folder = '';
    if (job.part === 'front') {
      basename = job.number ? `${safe(job.number)}-${job.quantity}` : `${safe(job.size)}-${job.quantity}`;
    } else if (job.part === 'back') {
      folder = 'BACK NAME/';
      basename = safe(job.name || `PLAYER-${job.size}`);
    } else if (job.part === 'backPaper') {
      folder='BACK NAME PAPER/';
      basename=`${safe(job.name || 'NO_NAME')}_${safe(job.number||'NO_NUMBER')}_SIZE-${safe(job.size)}-${job.quantity}`;
    } else if (job.part === 'sleeve') {
      basename = `SLEEVE ${job.sleeve.toUpperCase()} ${job.side.toUpperCase()}-${job.quantity}`;
    } else {
      basename = `COLLAR-${job.quantity}`;
    }
    let candidate = `${folder}${basename}.png`;
    if (usedNames.has(candidate.toLowerCase())) {
      const suffix = job.part === 'front' ? `-SIZE-${safe(job.size)}` : job.part === 'back' ? `-${safe(job.number || job.size)}` : `-SIZE-${safe(job.size || 'ALL')}`;
      candidate = `${folder}${basename}${suffix}.png`;
    }
    let counter = 2;
    const original = candidate;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = original.replace(/\.png$/i, `-${counter}.png`);
      counter++;
    }
    job.path = candidate;
    usedNames.add(candidate.toLowerCase());
  }
  return jobs;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('An uploaded artwork image could not be decoded. Upload it again.'));
    image.src = dataUrl;
  });
}

// A curved name/number is rendered from an SVG textPath (the very same
// text technology used by the editor preview), and then composited onto
// the print canvas at the precise inch-based anchor.
const svgEsc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');

async function drawSvgCurveText(ctx, text, options) {
  const {x,y,maxWidth,fontSize,family,fill,outline,outlineWidth,curve,gradient,shadow} = options;
  const svgNS = 'http://www.w3.org/2000/svg';
  const measureSvg = document.createElementNS(svgNS,'svg');
  measureSvg.setAttribute('width','1');
  measureSvg.setAttribute('height','1');
  measureSvg.setAttribute('style','position:fixed;left:-20000px;top:-20000px;overflow:visible;opacity:0;pointer-events:none');
  const sample = document.createElementNS(svgNS,'text');
  sample.setAttribute('x','0');sample.setAttribute('y','0');
  sample.setAttribute('font-size',String(fontSize));
  sample.setAttribute('font-weight','900');
  sample.setAttribute('font-family',String(family||'Arial'));
  sample.textContent=text;
  measureSvg.appendChild(sample);
  document.body.appendChild(measureSvg);
  let b;
  try { b=sample.getBBox(); }
  finally { measureSvg.remove(); }
  if (!b || b.width<=0 || b.height<=0) return;

  // Matches App.jsx FixedText: no enlargement for short text, shrink to width.
  const scale=Math.min(1,Math.max(1,maxWidth)/b.width);
  const span=Math.max(-80,Math.min(80,Number(curve)||0));
  const lift=span*fontSize/90;
  const cx=b.x+b.width/2,cy=b.y+b.height/2;
  const path=`M ${b.x} ${lift/2} Q ${cx} ${-lift/2} ${b.x+b.width} ${lift/2}`;

  // Pad for outlines/shadows and path arc. This avoids clipped edges even at
  // extreme curve values while keeping the anchor at the same center.
  const pad=Math.max(fontSize*.7,Math.abs(lift)*1.2,Math.abs(Number(outlineWidth)||0)*3,
    Math.abs(Number(shadow?.offsetX)||0)+Math.abs(Number(shadow?.offsetY)||0)+Number(shadow?.blur||0)*4);
  const imgW=Math.ceil(b.width+pad*2);
  const imgH=Math.ceil(b.height+pad*2+Math.abs(lift)*1.2);
  const gradientId='fill';
  const fillStyle=gradient?.enabled?`url(#${gradientId})`:svgEsc(fill||'#ffffff');
  const direction=gradient?.direction==='vertical' ? ['0%','0%','0%','100%'] : ['0%','0%','100%','0%'];
  const defs=`<path id="arc" d="${path}" fill="none"/>`+
    (gradient?.enabled?`<linearGradient id="${gradientId}" x1="${direction[0]}" y1="${direction[1]}" x2="${direction[2]}" y2="${direction[3]}"><stop offset="0%" stop-color="${svgEsc(gradient.start||fill||'#ffffff')}"/><stop offset="100%" stop-color="${svgEsc(gradient.end||fill||'#ffffff')}"/></linearGradient>`:'')+
    (shadow?.enabled?`<filter id="shadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="${Number(shadow.offsetX)||0}" dy="${Number(shadow.offsetY)||0}" stdDeviation="${Number(shadow.blur)||0}" flood-color="${svgEsc(shadow.color||'#000000')}"/></filter>`:'');
  const svg=`<svg xmlns="${svgNS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${imgW}" height="${imgH}" viewBox="${-imgW/2} ${-imgH/2} ${imgW} ${imgH}"><defs>${defs}</defs>`+
    `<g transform="translate(${-cx} ${-cy})"${shadow?.enabled?' filter="url(#shadow)"':''}>`+
    `<text font-size="${fontSize}" font-weight="900" font-family="${svgEsc(family||'Arial')}" fill="${fillStyle}" stroke="${svgEsc(outline||'none')}" stroke-width="${Number(outlineWidth)||0}" paint-order="stroke" stroke-linejoin="round">`+
    `<textPath href="#arc" xlink:href="#arc" startOffset="50%" text-anchor="middle">${svgEsc(text)}</textPath></text></g></svg>`;
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try {
    const img=await loadImage(url);
    ctx.drawImage(img,x-imgW*scale/2,y-imgH*scale/2,imgW*scale,imgH*scale);
  } finally { URL.revokeObjectURL(url); }
}

function drawFittedText(ctx, textValue, options) {
  const { x, y, maxWidth, maxHeight, family, fill, outline, outlineWidth, fontSize=100, curve=0, gradient, shadow } = options;
  const text = String(textValue ?? '').trim();
  if (!text) return;

  ctx.save();
  ctx.font = `900 ${fontSize}px "${String(family || 'Arial').replace(/["\\]/g,'')}"`;
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  const left = Number.isFinite(m.actualBoundingBoxLeft) ? m.actualBoundingBoxLeft : 0;
  const right = Number.isFinite(m.actualBoundingBoxRight) ? m.actualBoundingBoxRight : m.width;
  const ascent = m.actualBoundingBoxAscent || fontSize*0.75;
  const descent = m.actualBoundingBoxDescent || fontSize*0.25;
  const sourceW = Math.max(1, left + right);
  const sourceH = Math.max(1, ascent + descent);

  const targetW = Math.max(1, maxWidth);
  const targetH = maxHeight ? Math.max(1, maxHeight) : Math.max(1, sourceH * (targetW / sourceW));
  // Preserve requested point size for short text; shrink only when it exceeds its maximum width.
  const scale = maxHeight ? containScale(sourceW, sourceH, targetW, targetH) : Math.min(1,targetW / sourceW);

  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if(shadow?.enabled){
    ctx.shadowColor=shadow.color||'#000000';
    ctx.shadowBlur=(Number(shadow.blur)||0);
    ctx.shadowOffsetX=(Number(shadow.offsetX)||0);
    ctx.shadowOffsetY=(Number(shadow.offsetY)||0);
  }

  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = outline || 'transparent';
  if(gradient?.enabled){
    const g=gradient.direction==='vertical' ? ctx.createLinearGradient(0,-sourceH/2,0,sourceH/2) : ctx.createLinearGradient(-sourceW/2,0,sourceW/2,0);
    g.addColorStop(0,gradient.start||fill||'#ffffff');g.addColorStop(1,gradient.end||fill||'#ffffff');
    ctx.fillStyle=g;
  }else ctx.fillStyle = fill || '#ffffff';
  ctx.lineWidth = Math.max(0, Number(outlineWidth) || 0);
  const drawX = (left - right) / 2;
  const drawY = (ascent - descent) / 2;
  if (Math.abs(Number(curve) || 0) > 0.25) {
    // Use exactly the SVG textPath geometry from App.jsx, rather than
    // placing/rotating individual characters with Canvas. The latter
    // changes spacing, letter rotations and the apparent curve center.
    ctx.restore();
    return drawSvgCurveText(ctx, text, {
      x, y, maxWidth:targetW, fontSize, family, fill, outline,
      outlineWidth, curve, gradient, shadow,
    });
  }
  if (ctx.lineWidth > 0 && outline !== 'none') ctx.strokeText(text, drawX, drawY);
  ctx.fillText(text, drawX, drawY);
  ctx.restore();
}

function drawTextInches(ctx, value, settings, width, height, dpi, kind, positionOverride) {
  const isName = kind === 'name';
  const isSponsor = kind === 'sponsor';
  const isFrontNumber = kind === 'frontNumber';
  const x = positionOverride?.x ?? settings[isSponsor ? 'sponsorX' : isName ? 'nameX' : isFrontNumber ? 'frontNumberX' : 'numberX'];
  const y = positionOverride?.y ?? settings[isSponsor ? 'sponsorY' : isName ? 'nameY' : isFrontNumber ? 'frontNumberY' : 'numberY'];
  const maxWidthInches = isSponsor ? Number(positionOverride?.width ?? settings.sponsorWidth ?? 12)
    : isName ? Number(settings.nameWidth ?? 12)
      : isFrontNumber ? Number(settings.frontNumberWidth ?? 4)
        : Number(settings.numberWidth ?? 12);

  return drawFittedText(ctx, value, {
    x: (x / 100) * width * dpi,
    y: (y / 100) * height * dpi,
    maxWidth: maxWidthInches * (width/21) * dpi,
    maxHeight: null,
    family: isSponsor || isName ? (positionOverride?.font || settings.nameFont) : settings.numberFont,
    fill: isSponsor ? (positionOverride?.fill || settings.sponsorFill || '#ffffff') : isName ? settings.nameFill : settings.numberFill,
    outline: isSponsor ? (positionOverride?.stroke || '#111111') : isName ? settings.nameStroke : settings.numberStroke,
    outlineWidth: (Number(isSponsor ? positionOverride?.outlineWidth ?? 0 : isName ? settings.nameOutlineWidth : settings.numberOutlineWidth)||0) * dpi/72,
    fontSize:(Number(isSponsor ? positionOverride?.points ?? 160 : isName ? settings.namePoints ?? 195 : isFrontNumber ? settings.frontNumberPoints ?? 300 : settings.numberPoints ?? 650) || 100) * (width/21) * dpi / 72,
    curve:isSponsor ? positionOverride?.curve : isName ? settings.nameCurve : settings.numberCurve,
    gradient:{enabled:isSponsor ? positionOverride?.gradientEnabled : isName ? settings.nameGradientEnabled : settings.numberGradientEnabled,
      start:isSponsor ? positionOverride?.gradientStart : isName ? settings.nameGradientStart : settings.numberGradientStart,
      end:isSponsor ? positionOverride?.gradientEnd : isName ? settings.nameGradientEnd : settings.numberGradientEnd,
      direction:isSponsor ? positionOverride?.gradientDirection : isName ? settings.nameGradientDirection : settings.numberGradientDirection},
    shadow:{enabled:isSponsor ? positionOverride?.shadowEnabled : isName ? settings.nameShadowEnabled : settings.numberShadowEnabled,
      color:isSponsor ? positionOverride?.shadowColor : isName ? settings.nameShadowColor : settings.numberShadowColor,
      blur:(Number(isSponsor ? positionOverride?.shadowBlur : isName ? settings.nameShadowBlur : settings.numberShadowBlur)||0)*dpi/72,
      offsetX:(Number(isSponsor ? positionOverride?.shadowOffsetX : isName ? settings.nameShadowOffsetX : settings.numberShadowOffsetX)||0)*dpi/72,
      offsetY:(Number(isSponsor ? positionOverride?.shadowOffsetY : isName ? settings.nameShadowOffsetY : settings.numberShadowOffsetY)||0)*dpi/72},
  });
}

function drawTwinLabel(ctx, job, widthPx, heightPx, settings) {
  if (settings.markLabelEnabled === false) return;
  const position = settings.markLabelPosition || 'bottom-left';
  const [vertical,horizontal] = position === 'center' ? ['middle','center'] : position.split('-');
  const x = horizontal === 'left' ? 8 : horizontal === 'right' ? widthPx-8 : widthPx/2;
  const y = vertical === 'top' ? Math.max(16,heightPx*.02) : vertical === 'bottom' ? heightPx-Math.max(16,heightPx*.02) : heightPx/2;
  const label = `${sizeLabel(job.size).replace(/ \(.*\)$/,'')}-${job.quantity}`;
  ctx.save();ctx.textAlign=horizontal==='left'?'left':horizontal==='right'?'right':'center';
  ctx.textBaseline='middle'; ctx.font=`900 ${Math.max(13,Math.round(widthPx*.022))}px Arial`;
  ctx.lineJoin='round';ctx.lineWidth=Math.max(2,widthPx*.002);
  ctx.strokeStyle=settings.markLabelBackground||'#000000';ctx.strokeText(label,x,y);
  ctx.fillStyle=settings.markLabelColor||'#ffffff';ctx.fillText(label,x,y);ctx.restore();
}

function drawStandardEdgeMarks(ctx, widthPx, heightPx, dpi, settings, pageWidthIn, pageHeightIn, isFront, size) {
  ctx.save();
  if (settings.topMarkEnabled !== false) {
    const w = Math.max(1, Number(settings.topMarkWidth ?? .1) * (pageWidthIn / 21) * dpi);
    const h = Math.max(1, Number(settings.topMarkHeight ?? .3) * (pageHeightIn / 29) * dpi);
    ctx.fillStyle = settings.topMarkFill || '#ff0000';
    ctx.fillRect((widthPx - w) / 2, 0, w, h);
  }
  if (settings.bottomMarkEnabled !== false) {
    const w = Math.max(1, Number(settings.bottomMarkWidth ?? .5) * (pageWidthIn / 21) * dpi);
    const h = Math.max(1, Number(settings.bottomMarkHeight ?? .5) * (pageHeightIn / 29) * dpi);
    const x = (widthPx - w) / 2, y = heightPx - h;
    ctx.fillStyle = settings.bottomMarkFill || '#000000';
    ctx.fillRect(x, y, w, h);
    drawFittedText(ctx, String(size), {
      x: widthPx / 2, y: y + h/2, maxWidth: w*.8, maxHeight: h*.68,
      family: 'Arial', fill: settings.bottomMarkTextFill || '#ffffff', outline:'none', outlineWidth:0,
      fontSize: h*.6,
    });
  }
  ctx.restore();
}

function drawDualEdgeMarks(ctx, widthPx, heightPx, dpi, settings, pageWidthIn, pageHeightIn) {
  if(settings.topMarkEnabled === false) return;
  const w=Math.max(1,Number(settings.topMarkWidth ?? .1)*(pageWidthIn/21)*dpi);
  const h=Math.max(1,Number(settings.topMarkHeight ?? .3)*(pageHeightIn/29)*dpi);
  ctx.save();ctx.fillStyle=settings.topMarkFill||'#ff0000';
  ctx.fillRect((widthPx-w)/2,0,w,h);ctx.fillRect((widthPx-w)/2,heightPx-h,w,h);ctx.restore();
}

function drawMarks(ctx, size, widthPx, heightPx, dpi, settings, pageWidthIn, pageHeightIn) {
  ctx.save();
  if (settings.topMarkEnabled !== false) {
    const w = Math.max(1, Number(settings.topMarkWidth ?? 0.1) * (pageWidthIn / 21) * dpi);
    const h = Math.max(1, Number(settings.topMarkHeight ?? 0.3) * (pageHeightIn / 29) * dpi);
    ctx.fillStyle = settings.topMarkFill || '#ff0000';
    ctx.fillRect((widthPx - w) / 2, 0, w, h);
  }
  if (settings.bottomMarkEnabled !== false) {
    const w = Math.max(1, Number(settings.bottomMarkWidth ?? 0.5) * (pageWidthIn / 21) * dpi);
    const h = Math.max(1, Number(settings.bottomMarkHeight ?? 0.5) * (pageHeightIn / 29) * dpi);
    const x = (widthPx - w) / 2;
    const y = heightPx - h;
    ctx.fillStyle = settings.bottomMarkFill || '#000000';
    ctx.fillRect(x, y, w, h);
    drawFittedText(ctx, String(size), {
      x: widthPx / 2, y: y + h / 2, maxWidth: w * 0.8, maxHeight: h * 0.68,
      family: 'Arial', fill: settings.bottomMarkTextFill || '#ffffff', outline: 'none', outlineWidth: 0,
    });
  }
  ctx.restore();
}

function drawBackSleeveIdentifier(ctx, widthPx, heightPx, dpi, settings) {
  if (settings.sleeveMarkEnabled === false) return;
  const location = settings.sleeveMarkPosition || 'bottom-left';
  const text = String(settings.sleeveMarkText || 'FULL SLEEVE').trim();
  const marker = Math.max(0.1, Number(settings.sleeveMarkHeight ?? .5));
  const width = Math.max(1, marker * (widthPx / (21 * dpi)) * dpi);
  const height = Math.max(1, marker * (heightPx / (29 * dpi)) * dpi);
  const inset = Math.max(2, dpi * .045);
  const x = location.endsWith('left') ? inset + width/2 : location.endsWith('right') ? widthPx-inset-width/2 : widthPx/2;
  const y = location.startsWith('top') ? inset + height/2 : heightPx-inset-height/2;
  drawFittedText(ctx, text, { x, y, maxWidth: width*.94, maxHeight: height*.65, fontSize: height*.54, family:'Arial', fill:settings.sleeveMarkFill || '#000000', outline:'#ffffff', outlineWidth:Math.max(.6,dpi*.008) });
}

function withDpiMetadata(pngBytes, dpi) {
  const original = new Uint8Array(pngBytes);
  const header = new Uint8Array([137,80,78,71,13,10,26,10]);
  if (original.length < 33 || !header.every((value,i)=>original[i]===value)) throw new Error('Invalid PNG encoding.');
  const data = new Uint8Array(9);
  const meters = Math.round(dpi/0.0254);
  const dataView = new DataView(data.buffer);
  dataView.setUint32(0, meters, false);
  dataView.setUint32(4, meters, false);
  data[8] = 1;
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, data.length, false);
  chunk.set([112,72,89,115],4);
  chunk.set(data,8);
  let crc = 0xffffffff;
  for (let i=4;i<chunk.length-4;i++) {
    crc ^= chunk[i];
    for (let j=0;j<8;j++) crc = (crc>>>1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunkView.setUint32(chunk.length-4, (crc ^ 0xffffffff)>>>0,false);
  const afterIHDR = 8 + 4 + 4 + 13 + 4;
  const out = new Uint8Array(original.length+chunk.length);
  out.set(original.subarray(0,afterIHDR),0);
  out.set(chunk,afterIHDR);
  out.set(original.subarray(afterIHDR),afterIHDR+chunk.length);
  return new Blob([out],{type:'image/png'});
}

async function rasterize(job, settings, dpi, cache) {
  const [width, height] = job.dims;
  const widthPx = Math.round(width * dpi);
  const heightPx = Math.round(height * dpi);
  if (widthPx * heightPx > 115_000_000) {
    throw new Error(`${job.path} is ${widthPx} × ${heightPx}px and exceeds the browser-safe export limit. Lower DPI or page dimensions.`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Browser could not create a rendering context.');

  if (job.part !== 'backPaper') {
    const image = cache.get(job.src) || await loadImage(job.src);
    cache.set(job.src, image);
    ctx.save();
    if (job.mirror) { ctx.translate(widthPx, 0); ctx.scale(-1, 1); }
    ctx.drawImage(image, 0, 0, widthPx, heightPx);
    ctx.restore();
  }

  if (job.part === 'back') {
    if (settings.sponsorEnabled && Array.isArray(settings.sponsors)) {
      for (const line of settings.sponsors) {
        if (line.enabled === false || !String(line.text || '').trim()) continue;
        await drawTextInches(ctx, line.text, settings, width, height, dpi, 'sponsor', line);
      }
    }
    if (job.name) await drawTextInches(ctx, job.name, settings, width, height, dpi, 'name');
    if (String(job.number || '').trim()) await drawTextInches(ctx, job.number, settings, width, height, dpi, 'number');
    if (settings.markPreset === 'dual-edge') {
      drawDualEdgeMarks(ctx,widthPx,heightPx,dpi,settings,width,height);
      drawTwinLabel(ctx,job,widthPx,heightPx,settings);
    } else drawStandardEdgeMarks(ctx, widthPx, heightPx, dpi, settings, width, height, false, job.size);
    if (job.sleeve === 'Full') drawBackSleeveIdentifier(ctx, widthPx, heightPx, dpi, settings);
  }

  if (job.part === 'backPaper') {
    if (settings.sponsorEnabled && Array.isArray(settings.sponsors)) {
      for (const line of settings.sponsors) {
        if (line.enabled === false || !String(line.text || '').trim()) continue;
        await drawTextInches(ctx, line.text, settings, width, height, dpi, 'sponsor', line);
      }
    }
    if (job.name) await drawTextInches(ctx, job.name, settings, width, height, dpi, 'name');
    if (String(job.number || '').trim()) await drawTextInches(ctx, job.number, settings, width, height, dpi, 'number');
  }

  if (job.part === 'front') {
    if (settings.frontNumber && String(job.number || '').trim()) {
      await drawTextInches(ctx, job.number, settings, width, height, dpi, 'frontNumber');
    }
    if (settings.markPreset === 'dual-edge') {
      drawDualEdgeMarks(ctx,widthPx,heightPx,dpi,settings,width,height);
      drawTwinLabel(ctx,job,widthPx,heightPx,settings);
    } else drawStandardEdgeMarks(ctx, widthPx, heightPx, dpi, settings, width, height, true, job.size);
  }

  const outputCanvas = job.part === 'backPaper' ? trimTransparentBounds(canvas, 0) : canvas;
  const blob = await new Promise((resolve,reject) => outputCanvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG encoding failed.')),'image/png'));
  const result = {
    blob: withDpiMetadata(await blob.arrayBuffer(), dpi),
    dims: [outputCanvas.width / dpi, outputCanvas.height / dpi],
  };
  outputCanvas.width = 0;
  outputCanvas.height = 0;
  if (outputCanvas !== canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
  return result;
}

function trimTransparentBounds(canvas, padPx = 0) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha <= 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return canvas;
  left = Math.max(0, left - padPx);
  right = Math.min(width - 1, right + padPx);
  top = Math.max(0, top - padPx);
  bottom = Math.min(height - 1, bottom + padPx);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  const outCtx = out.getContext('2d', { alpha: true });
  if (!outCtx) return canvas;
  outCtx.clearRect(0, 0, out.width, out.height);
  outCtx.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}


export async function renderReviewThumbnail(job,settings,dpi=20){
  const result=await rasterize(job,settings,dpi,new Map());
  return URL.createObjectURL(result.blob);
}

async function convertPngBlob(pngBlob,format,dims,dpi){
  if(format==='PNG')return pngBlob;
  const url=URL.createObjectURL(pngBlob);
  const img=await loadImage(url);
  try{
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:format==='TIFF'});
    if(!ctx)throw new Error('Could not create export canvas.');
    if(format==='JPG'){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);}
    ctx.drawImage(img,0,0);
    if(format==='JPG')return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('JPEG encode failed.')),'image/jpeg',0.95));
    if(format==='TIFF'){
      const UTIF=await import('utif');
      const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const encoded=(UTIF.default||UTIF).encodeImage(rgba,canvas.width,canvas.height);
      return new Blob([encoded],{type:'image/tiff'});
    }
    if(format==='PDF'){
      const {jsPDF}=await import('jspdf');
      const pdf=new jsPDF({unit:'pt',format:[dims[0]*72,dims[1]*72],orientation:dims[0]>dims[1]?'landscape':'portrait',compress:true});
      // JPEG-in-PDF limits document size while retaining full pixel resolution.
      const jpg=canvas.toDataURL('image/jpeg',0.96);
      pdf.addImage(jpg,'JPEG',0,0,dims[0]*72,dims[1]*72,undefined,'FAST');
      return pdf.output('blob');
    }
    throw new Error('Unknown output format.');
  } finally {URL.revokeObjectURL(url);}
}

export async function exportProductionZip({players, settings, artwork, dpi=300, format='PNG', onProgress}) {
  if (![150,300].includes(Number(dpi))) throw new Error('Choose 150 or 300 DPI.');
  if(!['PNG','JPG','TIFF','PDF'].includes(format))throw new Error('Select PNG, JPG, TIFF or PDF.');
  const jobs = createProductionJobs(players, settings, artwork);
  try {
    await Promise.all([
      document.fonts.load(`900 100px "${settings.nameFont}"`),
      document.fonts.load(`900 100px "${settings.numberFont}"`),
    ]);
  } catch {}
  const zip = new JSZip();
  const cache = new Map();
  for (let i = 0; i < jobs.length; i++) {
    onProgress?.({ done: i, total: jobs.length, label: `Rendering ${jobs[i].path}` });
    const rendered = await rasterize(jobs[i], settings, Number(dpi), cache);
    const file=await convertPngBlob(rendered.blob,format,rendered.dims,Number(dpi));
    const extension={PNG:'png',JPG:'jpg',TIFF:'tif',PDF:'pdf'}[format];
    zip.file(jobs[i].path.replace(/\.png$/i,'.'+extension),file);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  cache.clear();
  onProgress?.({ done: jobs.length, total: jobs.length, label: 'Compressing PNG files into ZIP…' });
  const output = await zip.generateAsync({ type:'blob', compression:'STORE', streamFiles:true }, meta => {
    onProgress?.({ done: jobs.length, total: jobs.length, label:`Building ZIP ${Math.round(meta.percent)}%` });
  });
  const link = document.createElement('a');
  const url = URL.createObjectURL(output);
  link.href = url;
  link.download = `JERSEY_PRINT_FILES_${Date.now()}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { files: jobs.length, bytes: output.size };
}
