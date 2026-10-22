// Official shirt/jersey sublimation page presets, dimensions in inches.
export const SIZE_CHART = [
  ['20','6 Months',12,14], ['22','1–2 Years',13,16],
  ['24','3–4 Years',14,18], ['26','5–6 Years',15,20],
  ['28','7–8 Years',16,22], ['30','9–10 Years',17,24],
  ['32','11–12 Years',18,26], ['34','XS',19,27],
  ['36','S',20,28], ['38','M',21,29], ['40','L',22,30],
  ['42','XL',23,31], ['44','2XL',24,32], ['46','3XL',25,33],
  ['48','4XL',26,34], ['50','5XL',27,35],
];

export const DEFAULT_SIZES = Object.fromEntries(
  SIZE_CHART.map(([code,,width,height]) => [code,{width,height}])
);
const numericCodes = new Set(SIZE_CHART.map(row => row[0]));
const aliases = {
  XS:'34', XSMALL:'34', EXTRASMALL:'34',
  S:'36', SMALL:'36',
  M:'38', MEDIUM:'38',
  L:'40', LARGE:'40',
  XL:'42', XLARGE:'42', EXTRALARGE:'42',
  XXL:'44', '2XL':'44', '2X':'44', 'XXLARGE':'44',
  XXXL:'46', '3XL':'46', '3X':'46',
  XXXXL:'48', '4XL':'48', '4X':'48',
  XXXXXL:'50', '5XL':'50', '5X':'50',
  '6MONTHS':'20','6MONTH':'20','6MO':'20',
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
  // Handle combinations such as "L / 40", "40 (L)", and "SIZE XL".
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
  // Old app shipped all eight stock sizes as 21x29 placeholders.
  // Replace only those exact placeholders; respect discernibly customized presets.
  for (const [key, dimensions] of Object.entries(savedSizes||{})) {
    if (!dimensions || typeof dimensions!=='object') continue;
    const code=canonicalSize(key, savedSizes) || key;
    const legacyPlaceholder=['32','34','36','38','40','42','44','46'].includes(code)
      && Number(dimensions.width)===21 && Number(dimensions.height)===29;
    if (!legacyPlaceholder) result[code]={width:Number(dimensions.width),height:Number(dimensions.height)};
  }
  return result;
}
