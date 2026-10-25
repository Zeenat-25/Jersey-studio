// Locked official Jersey Studio standard sublimation page chart (inches).
// Customize only via a named copy of the Standard chart.
export const SIZE_CHART = [
  ['20','6 Months',12,18],
  ['22','1–2 Years',13,19],
  ['24','3–4 Years',14,20],
  ['26','5–6 Years',15,21],
  ['28','7–8 Years',16,22],
  ['30','9–10 Years',17,24],
  ['32','11–12 Years',18,26],
  ['34','XS',19,27],
  ['36','S',20,28],
  ['38','M',21,29],
  ['40','L',22,30],
  ['42','XL',23,31],
  ['44','2XL',24,32],
  ['46','3XL',25,33],
  ['48','4XL',26,34],
  ['50','5XL',27,35],
];

export const DEFAULT_SIZES = Object.fromEntries(SIZE_CHART.map(([code,,width,height]) => [code,{width,height}]));
const numericCodes = new Set(SIZE_CHART.map(row => row[0]));
const aliases = {
  XS:'34', XSMALL:'34', EXTRASMALL:'34',
  S:'36', SMALL:'36', M:'38', MEDIUM:'38', L:'40', LARGE:'40',
  XL:'42', XLARGE:'42', EXTRALARGE:'42',
  XXL:'44', '2XL':'44', '2X':'44', 'XXLARGE':'44',
  XXXL:'46', '3XL':'46', '3X':'46',
  XXXXL:'48', '4XL':'48', '4X':'48',
  XXXXXL:'50', '5XL':'50', '5X':'50',
  '6MONTHS':'20','6MONTH':'20','6MO':'20', '6MTH':'20',
  '1&2YEAR':'22','1&2YEARS':'22','1TO2YEARS':'22','1-2YEARS':'22',
  '3&4YEAR':'24','3&4YEARS':'24','3TO4YEARS':'24','3-4YEARS':'24',
  '5&6YEAR':'26','5&6YEARS':'26','5TO6YEARS':'26','5-6YEARS':'26',
  '7&8YEAR':'28','7&8YEARS':'28','7TO8YEARS':'28','7-8YEARS':'28',
  '9&10YEAR':'30','9&10YEARS':'30','9TO10YEARS':'30','9-10YEARS':'30',
  '11&12YEAR':'32','11&12YEARS':'32','11TO12YEARS':'32','11-12YEARS':'32',
};

export function canonicalSize(raw, customSizes={}) {
  const value=String(raw??'').trim();
  if (!value) return '';
  const token=value.toUpperCase().replace(/[\s_.]/g,'').replace(/[–—]/g,'-');
  if (numericCodes.has(token)) return token;
  if (aliases[token]) return aliases[token];
  const pieces=token.replace(/[()]/g,'/').split(/[/,]/).filter(Boolean);
  const resolved=pieces.map(piece=>aliases[piece]||(numericCodes.has(piece)?piece:null)).filter(Boolean);
  if (resolved.length && resolved.every(code=>code===resolved[0])) return resolved[0];
  if (token.startsWith('SIZE') && token.length>4) return canonicalSize(token.slice(4),customSizes);
  const customKey=Object.keys(customSizes).find(key=>key.toUpperCase()===value.toUpperCase());
  return customKey || '';
}

export function sizeLabel(code) {
  const match=SIZE_CHART.find(item=>item[0]===String(code));
  return match ? `${match[1]} (${match[0]})` : String(code);
}

export function migrateSizePresets(savedSizes={}) {
  const result={...DEFAULT_SIZES};
  for (const [key, dimensions] of Object.entries(savedSizes||{})) {
    if (!dimensions || typeof dimensions!=='object') continue;
    const code=canonicalSize(key, savedSizes) || key;
    const legacyPlaceholder=['32','34','36','38','40','42','44','46'].includes(code)
      && Number(dimensions.width)===21 && Number(dimensions.height)===29;
    if (!legacyPlaceholder) result[code]={width:Number(dimensions.width),height:Number(dimensions.height)};
  }
  return result;
}

const sleeveBands = {
  Half: [
    { min: 22, max: 28, width: 13, height: 7 },
    { min: 30, max: 34, width: 15, height: 9 },
    { min: 36, max: 42, width: 17.5, height: 10 },
    { min: 44, max: 50, width: 20, height: 11 },
  ],
  Full: [
    { min: 20, max: 24, width: 13, height: 18 },
    { min: 26, max: 28, width: 13, height: 21 },
    { min: 30, max: 34, width: 15, height: 23 },
    { min: 36, max: 42, width: 17.5, height: 26 },
    { min: 44, max: 50, width: 20, height: 26 },
  ],
};

export const STANDARD_SLEEVE_CHART = {
  Half: Object.fromEntries(['20','22','24','26','28','30','32','34','36','38','40','42','44','46','48','50'].map(code => {
    const n=Number(code);
    // The reference starts half sleeves at 22. Size 20 provisionally uses the 22–28 band.
    const dims = n <= 28 ? [13,7] : n <= 34 ? [15,9] : n <= 42 ? [17.5,10] : [20,11];
    return [code, {width:dims[0],height:dims[1]}];
  })),
  Full: Object.fromEntries(['20','22','24','26','28','30','32','34','36','38','40','42','44','46','48','50'].map(code => {
    const n=Number(code);
    const dims = n <= 24 ? [13,18] : n <= 28 ? [13,21] : n <= 34 ? [15,23] : n <= 42 ? [17.5,26] : [20,26];
    return [code, {width:dims[0],height:dims[1]}];
  })),
};

export function getSleeveDimensions(sizeCode, sleeveType='Half', chart=STANDARD_SLEEVE_CHART) {
  const code = Number(canonicalSize(sizeCode) || sizeCode || 38);
  const type = sleeveType === 'Full' ? 'Full' : 'Half';
  const key = String(code);
  const fromChart = chart?.[type]?.[key];
  if (fromChart && Number(fromChart.width) > 0 && Number(fromChart.height) > 0) {
    return {width:Number(fromChart.width), height:Number(fromChart.height)};
  }
  const band = sleeveBands[type].find(item => code >= item.min && code <= item.max);
  return band ? { width: band.width, height: band.height } : (type === 'Full' ? { width: 13, height: 18 } : { width: 13, height: 7 });
}


// Separate back-name transfer sheet: fixed width by size band, content-driven height.
export function backPaperWidth(sizeCode) {
  const code=Number(canonicalSize(sizeCode)||sizeCode);
  if(code>=44) return 14;
  if(code>=32) return 12;
  if(code>=26) return 10;
  return 8;
}
export function backPaperHeight(player={},settings={}) {
  const sponsorLines=settings.sponsorEnabled && Array.isArray(settings.sponsors)
    ? settings.sponsors.filter(line=>line.enabled!==false&&String(line.text||'').trim()).reduce((n,line)=>n+Math.max(1,String(line.text).split('\n').length),0) : 0;
  const num=String(player?.number||'').trim();
  const name=String(player?.name||'').trim();
  return Math.max(3, Number((2.0 + sponsorLines*.7 + (num?8:0) + (name?3:0)).toFixed(1)));
}
