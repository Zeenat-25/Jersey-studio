import { canonicalSize } from './sizeChart';
import JSZip from 'jszip';

const safe = value => String(value ?? '').trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'UNKNOWN';
const validNumber = value => Number.isFinite(Number(value)) && Number(value) > 0;
const inches = (value, label) => {
  if (!validNumber(value)) throw new Error(`${label} must be greater than zero.`);
  return Number(value);
};
const sizeDimensions = (settings, size) => {
  const normalized=canonicalSize(size,settings.sizes);
  const found = settings.sizes[normalized];
  if (!found) throw new Error(`Missing page-size preset for jersey size ${size}. Add it in Properties → Layout.`);
  return [inches(found.width, `Width for size ${size}`), inches(found.height, `Height for size ${size}`)];
};
function cleanedPlayers(players, settings) {
  if (!players.length) throw new Error('Add or import at least one player.');
  return players.map((p, i) => {
    if (!String(p.name ?? '').trim()) throw new Error(`Player ${i + 1} has no name.`);
    if (!String(p.number ?? '').trim()) throw new Error(`Player ${i + 1} has no number.`);
    const qty = Number(p.quantity);
    if (!Number.isInteger(qty) || qty < 1) throw new Error(`Player ${i + 1} has an invalid quantity.`);
    const rawSize=String(p.size || '').trim();
    const size=canonicalSize(rawSize,settings.sizes);
    if(!size) throw new Error(`Player ${i+1} (${p.name}) has unknown size '${rawSize}'. Choose a known code or add a custom preset.`);
    sizeDimensions(settings, size);
    return {...p, name:String(p.name).trim().toLocaleUpperCase(), number:String(p.number).trim(), size, quantity:qty, sleeve:p.sleeve === 'Full' ? 'Full' : 'Half'};
  });
}
function addGrouped(map, key, entry, player) {
  if (map.has(key)) { map.get(key).quantity += player.quantity; return; }
  map.set(key, {...entry, quantity:player.quantity});
}
export function createProductionJobs(players, settings, artwork) {
  const roster = cleanedPlayers(players, settings);
  if (!Object.keys(artwork).some(key => Boolean(artwork[key]))) throw new Error('Upload at least one jersey artwork component before exporting.');
  const groups = new Map();
  for (const p of roster) {
    const dims = sizeDimensions(settings, p.size);
    if (artwork.front) {
      // Front without a player number is identical for players of the same size;
      // combine quantities rather than duplicating output files.
      const key = `front|${p.size}|${settings.frontNumber ? p.number : ''}`;
      addGrouped(groups, key, {part:'front', size:p.size, number:settings.frontNumber ? p.number : '', name:p.name, dims, src:artwork.front}, p);
    }
    if (artwork.back) {
      const key = `back|${p.size}|${p.name}|${p.number}|${p.sleeve}`;
      addGrouped(groups, key, {part:'back', size:p.size, name:p.name, number:p.number, sleeve:p.sleeve, dims, src:artwork.back}, p);
    }
  }
  // A paired sleeve sheet contains LEFT and RIGHT side-by-side. One copy
  // of the sheet produces two sleeve pieces. The filename states PIECES.
  for (const sleeve of ['Half','Full']) {
    const available = roster.filter(p => p.sleeve === sleeve);
    const sizesToGenerate = [null]; // Identifiers belong to personalized back PNGs, never sleeve sheets.
    for(const sizeMark of sizesToGenerate){
    const matching = sizeMark ? available.filter(p=>p.size===sizeMark) : available;
    if (!matching.length) continue;
    const jerseys = matching.reduce((sum, p) => sum + p.quantity, 0);
    const generic = artwork[sleeve === 'Half' ? 'halfSleeve' : 'fullSleeve'];
    const left = artwork.leftSleeve || generic || artwork.rightSleeve;
    const right = artwork.rightSleeve || generic || artwork.leftSleeve;
    if (!left || !right) continue;
    const componentWidth = sleeve === 'Half' ? inches(settings.halfWidth, 'Half sleeve width') : inches(settings.fullWidth, 'Full sleeve width');
    const componentHeight = sleeve === 'Half' ? inches(settings.halfHeight, 'Half sleeve height') : inches(settings.fullHeight, 'Full sleeve height');
    const mirrorRight = !artwork.rightSleeve && Boolean(artwork.leftSleeve || generic);
    const mirrorLeft = !artwork.leftSleeve && Boolean(artwork.rightSleeve) && !generic;
    groups.set(`sleeves|${sleeve}|${sizeMark||'all'}`, {
      part:'sleevePair', sleeve, sizeMark, src:left, rightSrc:right,
      mirrorLeft, mirrorRight, dims:[componentWidth * 2, componentHeight],
      componentWidth, quantity:jerseys * 2, printCopies:jerseys,
    });
  }
  }
  if (artwork.collar) {
    groups.set('collar', {
      part:'collar', src:artwork.collar,
      dims:[inches(settings.collarWidth, 'Collar width'), inches(settings.collarHeight, 'Collar height')],
      quantity:roster.reduce((sum, p) => sum + p.quantity, 0),
      collarType:settings.collarType,
    });
  }
  const jobs = Array.from(groups.values());
  if (!jobs.length) throw new Error('There are no matching artwork parts for this player list.');
  // Match the reference print-folder layout: fronts and parts at ZIP root,
  // personalized back PNG files inside BACK NAME/. All entries are PNGs.
  // Collision handling NEVER overwrites existing output, even for duplicate names.
  const usedNames = new Set();
  for (const job of jobs) {
    let basename;
    let folder = '';
    if (job.part === 'front') {
      // Without front personalization: <SIZE>-<SUM OF QUANTITIES>.png
      // With front numbers: <NUMBER>-<QUANTITY>.png
      basename = job.number ? `${safe(job.number)}-${job.quantity}` : `${safe(job.size)}-${job.quantity}`;
    } else if (job.part === 'back') {
      folder = 'BACK NAME/';
      basename = safe(job.name);
    } else if (job.part === 'sleevePair') {
      basename = job.sleeve === 'Full' ? `FULL SLEEVES${job.sizeMark?'-'+safe(job.sizeMark):''}-${job.quantity} PCS` : `SLEEVES-${job.quantity} PCS`;
    } else {
      basename = `COLLAR-${job.quantity} PCS`;
    }
    let candidate = `${folder}${basename}.png`;
    if (usedNames.has(candidate.toLowerCase())) {
      // Front collisions can happen with the same number at different sizes.
      // Back collisions can happen with duplicated player names.
      const suffix = job.part === 'front' ? `-SIZE-${safe(job.size)}` : job.part === 'back' ? `-${safe(job.number)}` : '-ALT';
      candidate = `${folder}${basename}${suffix}.png`;
    }
    let counter = 2;
    const originalCandidate = candidate;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = originalCandidate.replace(/\.png$/i, `-${counter}.png`);
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
function drawFittedText(ctx, textValue, options) {
  const { x, y, width, height, family, fill, outline, outlineWidth } = options;
  const text = String(textValue ?? '');
  if (!text.trim()) return;
  ctx.save();
  ctx.font = `900 100px "${String(family || 'Arial').replace(/["\\]/g,'')}"`;
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  const left = Number.isFinite(m.actualBoundingBoxLeft) ? m.actualBoundingBoxLeft : 0;
  const right = Number.isFinite(m.actualBoundingBoxRight) ? m.actualBoundingBoxRight : m.width;
  const ascent = m.actualBoundingBoxAscent || 75;
  const descent = m.actualBoundingBoxDescent || 15;
  const sourceW = Math.max(1, left + right);
  const sourceH = Math.max(1, ascent + descent);
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(-width/2, -height/2, width, height);
  ctx.clip();
  ctx.scale(width / sourceW, height / sourceH);
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = outline || 'transparent';
  ctx.fillStyle = fill || '#ffffff';
  ctx.lineWidth = Math.max(0, Number(outlineWidth) || 0);
  const drawX = (left - right) / 2;
  const drawY = (ascent - descent) / 2;
  if (ctx.lineWidth > 0 && outline !== 'none') ctx.strokeText(text, drawX, drawY);
  ctx.fillText(text, drawX, drawY);
  ctx.restore();
}
function drawTextInches(ctx, value, settings, width, height, dpi, kind, positionOverride) {
  const isName = kind === 'name';
  const isSponsor = kind === 'sponsor';
  const x = positionOverride?.x ?? settings[isSponsor ? 'sponsorX' : isName ? 'nameX' : 'numberX'];
  const y = positionOverride?.y ?? settings[isSponsor ? 'sponsorY' : isName ? 'nameY' : 'numberY'];
  const w = settings[isSponsor ? 'sponsorWidth' : isName ? 'nameWidth' : 'numberWidth'];
  const h = settings[isSponsor ? 'sponsorHeight' : isName ? 'nameHeight' : 'numberHeight'];
  drawFittedText(ctx, value, {
    x: (x / 100) * width * dpi,
    y: (y / 100) * height * dpi,
    width: inches(w, `${kind} box width`) * dpi,
    height: inches(h, `${kind} box height`) * dpi,
    family: isSponsor || isName ? settings.nameFont : settings.numberFont,
    fill: isSponsor ? settings.sponsorFill : isName ? settings.nameFill : settings.numberFill,
    outline: isSponsor ? 'none' : isName ? settings.nameStroke : settings.numberStroke,
    outlineWidth: isSponsor ? 0 : settings.stroke,
  });
}
function drawMarks(ctx, size, widthPx, heightPx, dpi, settings) {
 ctx.save();
 if (settings.topMarkEnabled !== false) {
  const w=Math.max(1,Number(settings.topMarkWidth??0.1)*dpi),h=Math.max(1,Number(settings.topMarkHeight??0.3)*dpi);
  ctx.fillStyle=settings.topMarkFill||'#ff0000';ctx.fillRect((widthPx-w)/2,0,w,h);
 }
 if(settings.bottomMarkEnabled!==false){
  const w=Math.max(1,Number(settings.bottomMarkWidth??0.5)*dpi),h=Math.max(1,Number(settings.bottomMarkHeight??0.5)*dpi);
  const x=(widthPx-w)/2,y=heightPx-h;
  ctx.fillStyle=settings.bottomMarkFill||'#000000';ctx.fillRect(x,y,w,h);
  drawFittedText(ctx,String(size),{x:widthPx/2,y:y+h/2,width:w*.8,height:h*.68,family:'Arial',fill:settings.bottomMarkTextFill||'#ffffff',outline:'none',outlineWidth:0});
 }
 ctx.restore();
}
function drawBackSleeveIdentifier(ctx, widthPx, heightPx, dpi, settings) {
  if (settings.sleeveMarkEnabled === false) return;
  const location = settings.sleeveMarkPosition || 'bottom-left';
  const text = String(settings.sleeveMarkText || 'FULL SLEEVE').trim();
  const height = Math.max(1, Number(settings.sleeveMarkHeight ?? 0.2) * dpi);
  const width = Math.min(widthPx * 0.38, Math.max(dpi * 1.6, widthPx * 0.18));
  // Box touches the chosen print edge, with slight inset on the other axis.
  const x = location.endsWith('left') ? width / 2 : location.endsWith('right') ? widthPx - width / 2 : widthPx / 2;
  const y = location.startsWith('top') ? height / 2 : heightPx - height / 2;
  drawFittedText(ctx, text, {
    x, y, width, height, family:'Arial',
    fill:settings.sleeveMarkFill || '#000000', outline:'none', outlineWidth:0
  });
}
// PNG pHYs: explicitly embed pixels-per-meter so CorelDRAW/RIP applications
// can read the intended physical print resolution rather than assuming 96 DPI.
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
  chunk.set([112,72,89,115],4); // pHYs
  chunk.set(data,8);
  let crc = 0xffffffff;
  for (let i=4;i<chunk.length-4;i++) {
    crc ^= chunk[i];
    for(let j=0;j<8;j++) crc = (crc>>>1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunkView.setUint32(chunk.length-4, (crc ^ 0xffffffff)>>>0,false);
  // IHDR is the first PNG chunk and always has a 13-byte data payload.
  const afterIHDR = 8 + 4 + 4 + 13 + 4;
  const out = new Uint8Array(original.length+chunk.length);
  out.set(original.subarray(0,afterIHDR),0);
  out.set(chunk,afterIHDR);
  out.set(original.subarray(afterIHDR),afterIHDR+chunk.length);
  return new Blob([out],{type:'image/png'});
}
async function rasterize(job, settings, dpi, cache) {
  const [width,height] = job.dims;
  const widthPx = Math.round(width * dpi);
  const heightPx = Math.round(height * dpi);
  // A practical single-canvas safety limit. The browser may impose lower limits.
  if (widthPx*heightPx > 115_000_000) {
    throw new Error(`${job.path} is ${widthPx} × ${heightPx}px and exceeds the browser-safe export limit. Lower DPI or page dimensions.`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d', {alpha:true});
  if (!ctx) throw new Error('Browser could not create a rendering context.');
  const image = cache.get(job.src) || await loadImage(job.src);
  cache.set(job.src, image);
  if (job.part === 'sleevePair') {
    const rightImage = cache.get(job.rightSrc) || await loadImage(job.rightSrc);
    cache.set(job.rightSrc, rightImage);
    const halfWidth = widthPx / 2;
    function drawHalf(img, offsetX, shouldMirror) {
      ctx.save();
      ctx.translate(offsetX, 0);
      if (shouldMirror) {
        ctx.translate(halfWidth, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(img, 0, 0, halfWidth, heightPx);
      ctx.restore();
    }
    drawHalf(image, 0, job.mirrorLeft);
    drawHalf(rightImage, halfWidth, job.mirrorRight);

  } else {
    ctx.save();
    if (job.mirror) {
      ctx.translate(widthPx, 0);
      ctx.scale(-1, 1);
    }
    // Artwork has already been prepared as a flat sublimation design.
    ctx.drawImage(image, 0, 0, widthPx, heightPx);
    ctx.restore();
  }
  if (job.part === 'back') {
    if (settings.sponsorEnabled && String(settings.sponsorText || '').trim()) {
      drawTextInches(ctx, settings.sponsorText, settings, width, height, dpi, 'sponsor');
    }
    drawTextInches(ctx, job.name, settings, width, height, dpi, 'name');
    drawTextInches(ctx, job.number, settings, width, height, dpi, 'number');
    drawMarks(ctx,job.size,widthPx,heightPx,dpi,settings);
    if (job.sleeve === 'Full') drawBackSleeveIdentifier(ctx,widthPx,heightPx,dpi,settings);
  }
  if (job.part === 'front') {
    if (settings.frontNumber) {
      const pos = settings.frontPosition === 'left' ? 25 : settings.frontPosition === 'right' ? 75 : 50;
      // Match the front-position preview and its half-scale number box.
      const adjusted = {...settings, numberWidth:Math.min(Number(settings.numberWidth),4), numberHeight:Math.min(Number(settings.numberHeight),3)};
      drawTextInches(ctx, job.number, adjusted, width, height, dpi, 'number', {x:pos,y:36});
    }
    drawMarks(ctx,job.size,widthPx,heightPx,dpi,settings);
  }
  const blob = await new Promise((resolve,reject) => canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed.')),'image/png'));
  canvas.width=0;
  canvas.height=0;
  return withDpiMetadata(await blob.arrayBuffer(),dpi);
}
export async function exportProductionZip({players, settings, artwork, dpi=300, onProgress}) {
  if (![150,300].includes(Number(dpi))) throw new Error('Choose 150 or 300 DPI.');
  const jobs = createProductionJobs(players,settings,artwork);
  // Font uploads live in the document's FontFaceSet. Ensure the active fonts are ready.
  try { await Promise.all([document.fonts.load(`900 100px "${settings.nameFont}"`),document.fonts.load(`900 100px "${settings.numberFont}"`)]); } catch { /* browser font fallback */ }
  const zip = new JSZip();
  const cache = new Map();
  for (let i=0; i<jobs.length; i++) {
    onProgress?.({done:i,total:jobs.length,label:`Rendering ${jobs[i].path}`});
    const png = await rasterize(jobs[i],settings,Number(dpi),cache);
    zip.file(jobs[i].path,png);
    // Allow the browser's UI to update and keep progress visible between large files.
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  cache.clear();
  onProgress?.({done:jobs.length,total:jobs.length,label:'Compressing PNG files into ZIP…'});
  const output = await zip.generateAsync({type:'blob',compression:'STORE',streamFiles:true}, meta => {
    onProgress?.({done:jobs.length,total:jobs.length,label:`Building ZIP ${Math.round(meta.percent)}%`});
  });
  const link = document.createElement('a');
  const url = URL.createObjectURL(output);
  link.href = url;
  link.download = `JERSEY_PRINT_FILES_${Date.now()}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60_000);
  return {files:jobs.length, bytes:output.size};
}
