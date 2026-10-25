import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './App.css';
import * as XLSX from 'xlsx';
import { recognize } from 'tesseract.js';
import { createProductionJobs, exportProductionZip } from './exportEngine';
import { DEFAULT_SIZES, STANDARD_SLEEVE_CHART, canonicalSize, getSleeveDimensions, migrateSizePresets, sizeLabel } from './sizeChart';
import { ExportReview } from './ExportReview';
import { loadArtwork } from './artworkImport';
import { scaleBox, scaleWidth, scalePoints } from './sizingMath';
import VectorWorkspace from './VectorWorkspace';

const initialSizes = DEFAULT_SIZES;
const DEFAULT_CHARTS = { Standard: DEFAULT_SIZES };
const upper = v => String(v ?? '').toLocaleUpperCase();
const sponsorTemplate = (id = Date.now(), font = 'Arial') => ({
  id,
  enabled: true,
  label: `Sponsor ${id}`,
  text: '',
  x: 50,
  y: 12,
  paperX: 50,
  paperY: 10,
  width: 12,
  points: 160,
  font,
  fill: '#ff0000',
  stroke: '#111111',
  outlineWidth: 0,
  curve: 0,
  gradientEnabled: false,
  gradientStart: '#ff0000',
  gradientEnd: '#ffffff',
  gradientDirection: 'horizontal',
  shadowEnabled: false,
  shadowColor: '#000000',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
});

const initialSettings = {
  sizes: initialSizes,
  editSize: '38',
  nameFont: 'Arial',
  numberFont: 'Impact',
  namePoints: 195,
  numberPoints: 650,
  nameWidth: 12,
  numberWidth: 12,
  nameFill: '#ffffff',
  nameStroke: '#111111',
  nameOutlineWidth: 2,
  nameCurve: 0,
  nameGradientEnabled: false,
  nameGradientStart: '#ffffff',
  nameGradientEnd: '#ffffff',
  nameGradientDirection: 'horizontal',
  nameShadowEnabled: false,
  nameShadowColor: '#000000',
  nameShadowBlur: 0,
  nameShadowOffsetX: 0,
  nameShadowOffsetY: 0,
  numberFill: '#ffffff',
  numberStroke: '#111111',
  numberOutlineWidth: 2,
  numberCurve: 0,
  numberGradientEnabled: false,
  numberGradientStart: '#ffffff',
  numberGradientEnd: '#ffffff',
  numberGradientDirection: 'horizontal',
  numberShadowEnabled: false,
  numberShadowColor: '#000000',
  numberShadowBlur: 0,
  numberShadowOffsetX: 0,
  numberShadowOffsetY: 0,
  sponsorEnabled: false,
  sponsors: [sponsorTemplate(1)],
  nameX: 50,
  nameY: 24,
  numberX: 50,
  numberY: 51,
  paperNameX: 50,
  paperNameY: 84,
  paperNumberX: 50,
  paperNumberY: 34,
  topMarkEnabled: true,
  topMarkWidth: 0.1,
  topMarkHeight: 0.3,
  topMarkFill: '#ff0000',
  bottomMarkEnabled: true,
  bottomMarkWidth: 0.5,
  bottomMarkHeight: 0.5,
  bottomMarkFill: '#000000',
  bottomMarkTextFill: '#ffffff',
  markPreset: 'standard', // Standard preserves the existing print marks.
  markLabelPosition: 'bottom-left',
  markLabelColor: '#ffffff',
  markLabelBackground: '#000000',
  markLabelEnabled: true,
  smartGuidesEnabled: true,
  smartGuideColor: '#00f0ff',
  sleeveMarkEnabled: true,
  sleeveMarkText: 'FULL SLEEVE',
  sleeveMarkPosition: 'bottom-left',
  sleeveMarkFill: '#000000',
  sleeveMarkHeight: 0.5,
  backPaperEnabled: true,
  frontNumber: false,
  frontNumberX: 50,
  frontNumberY: 36,
  frontNumberWidth: 4,
  frontNumberPoints: 300,
  halfWidth: 18,
  halfHeight: 11,
  fullWidth: 18,
  fullHeight: 26,
  collarType: 'ready',
  collarWidth: 18,
  collarHeight: 4,
};

const defaultPlayers = [
  { id: 1, name: 'RAHUL', number: '07', size: '38', quantity: 1, sleeve: 'Half' },
  { id: 2, name: 'AMAN', number: '10', size: '40', quantity: 2, sleeve: 'Full' },
];
const uploadTypes = [['front', 'Front'], ['back', 'Back'], ['leftHalfSleeve', 'Left half sleeve'], ['rightHalfSleeve', 'Right half sleeve'], ['leftFullSleeve', 'Left full sleeve'], ['rightFullSleeve', 'Right full sleeve'], ['collar', 'Collar']];
const basicFonts = ['Arial', 'Arial Black', 'Impact', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Segoe UI'];
function fromStorage(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function Field({ label, value, onChange, type = 'number', step = 1, min = 0, disabled = false }) { return <label className="field"><span>{label}</span><input type={type} step={step} min={min} disabled={disabled} value={value} onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)} /></label>; }
function ColorField({ label, value, onChange }) { return <label className="color-field"><span>{label}</span><input type="color" value={value} onChange={e => onChange(e.target.value)} /></label>; }

function cleanCell(value) { return String(value ?? '').trim(); }
function normalizeHeader(value) { return cleanCell(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }
const columns = {
  name: ['name', 'playername', 'playersname', 'fullname', 'player'],
  number: ['number', 'no', 'jerseyno', 'jerseynumber', 'playernumber', 'num'],
  size: ['size', 'shirtsize', 'jerseysize', 'tshirtsize'],
  quantity: ['quantity', 'qty', 'count', 'pieces', 'pcs'],
  sleeve: ['sleeve', 'sleeves', 'sleevetype'],
};
// Column-aware roster parser. Header order may vary; headerless rows are classified
// by sleeve/size/name/number tokens, and ambiguous cells remain in the review grid.
function parseRows(rows, defaultSize = '38') {
  const filtered = rows.map(row => Array.isArray(row) ? row.map(cleanCell) : []).filter(row => row.some(Boolean));
  if (!filtered.length) return [];
  const headers = filtered[0].map(normalizeHeader);
  const positions = Object.fromEntries(Object.entries(columns).map(([kind, aliases]) =>
    [kind, headers.findIndex(value => aliases.includes(value))]));
  const hasHeader = Object.values(positions).filter(index => index >= 0).length >= 2;
  const records = hasHeader ? filtered.slice(1) : filtered;
  const sizeKey = token => canonicalSize(token) || '';
  const sleeveType = token => /^(full|half)(\s*sleeves?)?$/i.test(token) ? (/^full/i.test(token) ? 'Full' : 'Half') : null;
  const isNumber = token => /^\d{1,4}$/.test(token);
  return records.map((cells, index) => {
    let name = '', number = '', size = '', quantity = 1, sleeve = 'Half';
    if (hasHeader) {
      const get = key => positions[key] >= 0 ? cleanCell(cells[positions[key]]) : '';
      name = get('name'); number = get('number'); size = get('size');
      quantity = Number(get('quantity')) || 1;
      sleeve = sleeveType(get('sleeve')) || 'Half';
    } else {
      const tokens = cells.flatMap(cell => cell.split(/[;,\t]+/).map(t => t.trim()).filter(Boolean));
      const used = new Set();
      const take = (index) => { used.add(index); return tokens[index]; };
      const sleeveIndex = tokens.findIndex(token => sleeveType(token));
      if (sleeveIndex >= 0) sleeve = sleeveType(take(sleeveIndex));
      // Explicit size aliases are unambiguous. Numeric sizes are identified
      // preferentially near a name, leaving leading-zero jersey numbers intact.
      let sizeIndex = tokens.findIndex((token, i) => !used.has(i) && sizeKey(token) && !/^\d+$/.test(token));
      if (sizeIndex < 0) sizeIndex = tokens.findIndex((token,i) => !used.has(i) && /^(20|22|24|26|28|30|32|34|36|38|40|42|44|46|48|50)$/.test(token));
      if (sizeIndex >= 0) size = sizeKey(take(sizeIndex));
      let nameIndex = tokens.findIndex((token,i) => !used.has(i) && /[\p{L}]/u.test(token) && !sizeKey(token) && !sleeveType(token));
      if (nameIndex >= 0) name = take(nameIndex);
      // Expand multi-word names while preserving the numeric columns.
      for (let i=0;i<tokens.length;i++) if (!used.has(i) && /[\p{L}]/u.test(tokens[i]) && !sizeKey(tokens[i]) && !sleeveType(tokens[i])) {
        name = [name, take(i)].filter(Boolean).join(' ');
      }
      const remaining = tokens.map((token,i) => ({token,i})).filter(item => !used.has(item.i) && isNumber(item.token));
      // One number is the jersey number. A second trailing number can be quantity.
      if (remaining.length) number = take(remaining[0].i);
      if (remaining.length >= 2) quantity = Number(take(remaining[1].i)) || 1;
      // When size is omitted, use the selected default without removing a player.
    }
    return { id: Date.now() + index * 1009 + Math.round(Math.random() * 100000),
      name: upper(name), number, size: sizeKey(size) || size || defaultSize,
      quantity: Number.isFinite(Number(quantity)) && Number(quantity) > 0 ? Math.floor(Number(quantity)) : 1,
      sleeve };
  }).filter(row => row.name || row.number);
}
function parseTyped(text, defaultSize = '38') {
  const rows = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    if (/[\t,;]/.test(line)) return line.split(/[\t,;]/).map(item => item.trim());
    // A whitespace-delimited header is still a header regardless of column order.
    const parts = line.split(/\s+/);
    if (parts.filter(part => Object.values(columns).some(aliases => aliases.includes(normalizeHeader(part)))).length >= 2) return parts;
    return line.match(/(?:"[^"]*"|'[^']*'|\S+)/g)?.map(part => part.replace(/^["']|["']$/g,'')) || [];
  });
  return parseRows(rows, defaultSize);
}

function FixedText({ value, cx, cy, width, points, fontFamily, fill, stroke, outlineWidth = 0, selected, onSelect, onMove, pageWidth, pageHeight, pxPerIn = 100, curve = 0, gradientEnabled = false, gradientStart = '#ffffff', gradientEnd = '#ffffff', gradientDirection = 'horizontal', shadowEnabled = false, shadowColor = '#000000', shadowBlur = 0, shadowOffsetX = 0, shadowOffsetY = 0 }) {
  const id = useId();
  const measureRef = useRef(null);
  const [bounds, setBounds] = useState({ width: 100, height: 80, x: -50, y: -60 });
  useEffect(() => {
    if (!measureRef.current) return;
    try {
      const b = measureRef.current.getBBox();
      if (b.width > 0 && b.height > 0) setBounds({ width: b.width, height: b.height, x: b.x, y: b.y });
    } catch { }
  }, [value, fontFamily, points]);
  const boxW = Math.max(0.1, width) * pxPerIn;
  const xx = (cx / 100) * pageWidth * pxPerIn;
  const yy = (cy / 100) * pageHeight * pxPerIn;
  const fontSize = Math.max(1, points);
  const scale = Math.min(1, boxW / Math.max(1, bounds.width));
  const displayHeight = Math.max(20, bounds.height * scale + 20);
  const offsetX = -(bounds.x + bounds.width / 2);
  const offsetY = -(bounds.y + bounds.height / 2);
  // Use exactly the same text coordinate system and translation whether curved or straight.
  // A quadratic arc with endpoints at lift/2 and its control at -lift/2
  // crosses y=0 at its midpoint. Therefore changing curve never moves the center.
  const normalizedCurve = Math.max(-80, Math.min(80, Number(curve) || 0));
  const lift = normalizedCurve * fontSize / 90;
  const path = `M ${bounds.x} ${lift / 2} Q ${bounds.x + bounds.width / 2} ${-lift / 2} ${bounds.x + bounds.width} ${lift / 2}`;
  const fillValue = gradientEnabled ? `url(#grad-${id})` : fill;
  const filterId = `shadow-${id}`;
  return <g onPointerDown={e => { e.stopPropagation(); onSelect?.(); onMove?.(e); }} style={{ cursor: 'move' }}>
    <defs>
      {gradientEnabled && <linearGradient id={`grad-${id}`} x1="0%" y1="0%" x2={gradientDirection === 'vertical' ? '0%' : '100%'} y2={gradientDirection === 'vertical' ? '100%' : '0%'}>
        <stop offset="0%" stopColor={gradientStart} />
        <stop offset="100%" stopColor={gradientEnd} />
      </linearGradient>}
      {Math.abs(Number(curve) || 0) > 0.25 && <path id={`curve-${id}`} d={path} fill="none" />}
      {shadowEnabled && <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx={shadowOffsetX} dy={shadowOffsetY} stdDeviation={shadowBlur} floodColor={shadowColor} />
      </filter>}
    </defs>
    <text ref={measureRef} x={0} y={0} fontSize={fontSize} fontWeight={900} fontFamily={fontFamily} visibility="hidden" pointerEvents="none">{value || ' '}</text>
    <g transform={`translate(${xx} ${yy}) scale(${scale} ${scale}) translate(${offsetX} ${offsetY})`} filter={shadowEnabled ? `url(#${filterId})` : undefined}>
      {Math.abs(normalizedCurve) > 0.001 ? (
        <text fontSize={fontSize} fontWeight={900} fontFamily={fontFamily} fill={fillValue} stroke={stroke} strokeWidth={outlineWidth} paintOrder="stroke">
          <textPath href={`#curve-${id}`} startOffset="50%" textAnchor="middle">{value || ' '}</textPath>
        </text>
      ) : (
        <text x={0} y={0} fontSize={fontSize} fontWeight={900} fontFamily={fontFamily} fill={fillValue} stroke={stroke} strokeWidth={outlineWidth} paintOrder="stroke">{value || ' '}</text>
      )}
    </g>
    {selected && <rect x={xx - boxW / 2} y={yy - displayHeight / 2} width={boxW} height={displayHeight} fill="none" stroke="#4b4b4b" strokeWidth={Math.max(2, pxPerIn * .025)} strokeDasharray="12 8" pointerEvents="none" />}
  </g>;
}

function App() {
  const [workspace, setWorkspace] = useState('sizing');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState('artwork');
  const [importText, setImportText] = useState('');
  const [importResults, setImportResults] = useState([]);
  const [importStatus, setImportStatus] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [settings, setSettings] = useState(() => {
    const saved = fromStorage('js-settings', {});
    const chart = fromStorage('js-active-chart', 'Standard');
    const migratedSponsors = Array.isArray(saved.sponsors) && saved.sponsors.length
      ? saved.sponsors
      : saved.sponsorText
        ? [{ ...sponsorTemplate(1, saved.nameFont || 'Arial'), text: saved.sponsorText, fill: saved.sponsorFill || '#ff0000', x: saved.sponsorX ?? 50, y: saved.sponsorY ?? 12, width: saved.sponsorWidth ?? 12 }]
        : [sponsorTemplate(1, saved.nameFont || 'Arial')];
    return {
      ...initialSettings,
      ...saved,
      namePoints: Number(saved.namePoints) || 195,
      numberPoints: Number(saved.numberPoints) || 650,
      nameWidth: Number(saved.nameWidth) || 12,
      numberWidth: Number(saved.numberWidth) || 12,
      nameOutlineWidth: Number(saved.nameOutlineWidth ?? saved.stroke ?? 2),
      numberOutlineWidth: Number(saved.numberOutlineWidth ?? saved.stroke ?? 2),
      editSize: canonicalSize(saved.editSize || '38', saved.sizes) || '38',
      sizes: chart === 'Standard' ? structuredClone(DEFAULT_SIZES) : migrateSizePresets(saved.sizes),
      sponsors: migratedSponsors,
      sleeveMarkHeight: Number(saved.sleeveMarkHeight ?? .5) === .2 ? .5 : Number(saved.sleeveMarkHeight ?? .5),
    };
  });
  const [chartNames, setChartNames] = useState(() => {
    const old = fromStorage('js-size-charts', null);
    if (old && typeof old === 'object') return { ...old, Standard: DEFAULT_SIZES };
    const previous = fromStorage('js-settings', {}).sizes;
    const customized = previous && Object.entries(previous).some(([key, d]) => DEFAULT_SIZES[key] && (Number(d.width) !== DEFAULT_SIZES[key].width || Number(d.height) !== DEFAULT_SIZES[key].height));
    return customized ? { Standard: DEFAULT_SIZES, 'Previous Custom': migrateSizePresets(previous) } : { Standard: DEFAULT_SIZES };
  });
  const [activeChart, setActiveChart] = useState(() => fromStorage('js-active-chart', 'Standard'));
  const [sleeveProfiles,setSleeveProfiles] = useState(() => ({...fromStorage('js-sleeve-charts',{}), Standard:structuredClone(STANDARD_SLEEVE_CHART)}));
  const [activeSleeveProfile,setActiveSleeveProfile] = useState(() => fromStorage('js-active-sleeve-chart','Standard'));
  const sleeveChart = sleeveProfiles[activeSleeveProfile] || STANDARD_SLEEVE_CHART;
  useEffect(()=>localStorage.setItem('js-sleeve-charts',JSON.stringify(sleeveProfiles)),[sleeveProfiles]);
  useEffect(()=>localStorage.setItem('js-active-sleeve-chart',JSON.stringify(activeSleeveProfile)),[activeSleeveProfile]);
  function createSleeveProfile(){
    const name=window.prompt('Name for your new sleeve chart');
    if(!name?.trim())return;
    const key=name.trim();
    if(Object.keys(sleeveProfiles).some(k=>k.toLowerCase()===key.toLowerCase())){setNotice('A sleeve chart with that name already exists.');return;}
    setSleeveProfiles(p=>({...p,[key]:structuredClone(sleeveChart)}));
    setActiveSleeveProfile(key);
  }
  function updateSleeveChart(type,code,field,value){
    if(activeSleeveProfile==='Standard')return;
    setSleeveProfiles(all=>({...all,[activeSleeveProfile]:{
      ...all[activeSleeveProfile],
      [type]:{...all[activeSleeveProfile][type],[code]:{...all[activeSleeveProfile][type][code],[field]:value}},
    }}));
  }
  function deleteSleeveProfile(){
    if(activeSleeveProfile==='Standard'||!window.confirm('Delete this custom sleeve chart?'))return;
    setSleeveProfiles(all=>{const result={...all};delete result[activeSleeveProfile];return result;});
    setActiveSleeveProfile('Standard');
  }

  useEffect(() => { const selected = chartNames[activeChart] || DEFAULT_SIZES; setSettings(old => ({ ...old, sizes: structuredClone(selected) })); }, [activeChart]);
  useEffect(() => localStorage.setItem('js-size-charts', JSON.stringify(chartNames)), [chartNames]);
  useEffect(() => localStorage.setItem('js-active-chart', JSON.stringify(activeChart)), [activeChart]);
  const chartWasLoaded = useRef(false);
  useEffect(() => { if (!chartWasLoaded.current) { chartWasLoaded.current = true; return; } if (activeChart === 'Standard') return; setChartNames(c => ({ ...c, [activeChart]: structuredClone(settings.sizes) })); }, [settings.sizes, activeChart]);
  const [players, setPlayers] = useState(() => fromStorage('js-players', defaultPlayers).map(p => ({ ...p, name: upper(p.name), size: canonicalSize(p.size) || p.size })));
  const [art, setArt] = useState({});
  const [fonts, setFonts] = useState(basicFonts);
  const [fontStatus, setFontStatus] = useState('Installed font discovery requires permission in Chrome/Edge on localhost or HTTPS.');
  const [playerIndex, setPlayerIndex] = useState(0);
  const [side, setSide] = useState('back');
  const [grouped, setGrouped] = useState(false);
  const [activeControl, setActiveControl] = useState('name');
  const [textWasSelected, setTextWasSelected] = useState(false);
  const [notice, setNotice] = useState('');
  const [exportDpi, setExportDpi] = useState(300);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  const [settingsTab, setSettingsTab] = useState('text');
  const [rightToolsOpen, setRightToolsOpen] = useState(false);
  const [rightTool, setRightTool] = useState('text');
  const [guideLines, setGuideLines] = useState({x:null,y:null});
  const [previewZoom, setPreviewZoom] = useState(100);
  const stageRef = useRef(null);
  const panRef = useRef(null);
  const startPan = event => {
    if (event.button !== 1 || !stageRef.current) return;
    event.preventDefault();
    const stage = stageRef.current;
    panRef.current = {x:event.clientX,y:event.clientY,left:stage.scrollLeft,top:stage.scrollTop};
    stage.style.cursor = 'grabbing';
    const move = e => {
      if (!panRef.current) return;
      stage.scrollLeft = panRef.current.left + panRef.current.x - e.clientX;
      stage.scrollTop = panRef.current.top + panRef.current.y - e.clientY;
    };
    const stop = () => {
      panRef.current = null;
      stage.style.cursor = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('blur', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('blur', stop);
  };
  const selectedElementRef = useRef(null);

  const [exportReviewOpen,setExportReviewOpen] = useState(false);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const sponsorFocusRef = useRef(null);
  const fontFiles = useRef([]);
  useEffect(() => { localStorage.setItem('js-settings', JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem('js-players', JSON.stringify(players)); }, [players]);
  useEffect(() => () => { fontFiles.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const set = (key, value) => setSettings(s => ({ ...s, [key]: value }));
  const sizes = Object.keys(settings.sizes);
  const player = players[Math.min(playerIndex, players.length - 1)] || null;
  const currentSize = canonicalSize(player?.size || settings.editSize, settings.sizes) || player?.size || settings.editSize;
  const dimensions = settings.sizes[currentSize] || { width: 21, height: 29 };
  const invalidPlayers = players.filter(p => !canonicalSize(p.size, settings.sizes));
  const counts = useMemo(() => players.reduce((v, p) => v + (Number(p.quantity) || 0), 0), [players]);
  const image = ['back','front','collar'].includes(side) ? art[side] : null;
  const sleeveView = side === 'halfSleeve' || side === 'fullSleeve';
  const sleeveViewType = side === 'fullSleeve' ? 'Full' : 'Half';
  const sleeveViewDims = getSleeveDimensions(currentSize, sleeveViewType, sleeveChart);
  const sleeveGap = 1; // inches between the two pieces in the preview
  const currentSleeveType = player?.sleeve === 'Full' ? 'Full' : 'Half';
  const currentSleeveDims = getSleeveDimensions(currentSize, currentSleeveType, sleeveChart);
  const isSleevePreview = sleeveView;
  const realWidth = Math.max(.1, Number(dimensions.width) || 21);
  const realHeight = Math.max(.1, Number(dimensions.height) || 29);
  const u = 100;
  const scaledBox = (w, h) => scaleBox(w, h, realWidth, realHeight);
  const scaledNameWidth = scaleWidth(settings.nameWidth, realWidth);
  const scaledNumberWidth = scaleWidth(settings.numberWidth, realWidth);
  const scaledNamePoints = scalePoints(settings.namePoints, realWidth);
  const scaledNumberPoints = scalePoints(settings.numberPoints, realWidth);
  const sponsorLayers = Array.isArray(settings.sponsors) ? settings.sponsors : [];
  const sponsorOptions = sponsorLayers.map(layer => ({ id: layer.id, label: layer.label || layer.text || `Sponsor ${layer.id}` }));
  const activeSponsorId = activeControl.startsWith('sponsor:') ? Number(activeControl.split(':')[1]) : sponsorLayers[0]?.id;
  const activeSponsor = sponsorLayers.find(layer => layer.id === activeSponsorId) || sponsorLayers[0] || null;

  async function readImage(file, cb) { if (!file) return; try { const result = await loadArtwork(file); cb(result); setNotice(`${file.name} loaded (first page for PDF/TIFF).`); } catch (e) { setNotice(`Artwork import error: ${e.message}`); } }
  async function findLocalFonts() {
    if (!('queryLocalFonts' in window)) { setFontStatus('This browser does not support local font enumeration. Use Chrome/Edge on localhost or upload a font.'); return; }
    try { const result = await window.queryLocalFonts(); const names = [...new Set(result.map(f => f.family).filter(Boolean))].sort((a, b) => a.localeCompare(b)); setFonts(prev => [...new Set([...prev, ...names])]); setFontStatus(`Found ${names.length} installed font families. Select a font below.`); }
    catch { setFontStatus('Font access was denied or unavailable. Allow the browser permission or upload font files.'); }
  }
  async function uploadFont(file) {
    if (!file) return;
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) { setNotice('Upload a TTF, OTF, WOFF or WOFF2 font.'); return; }
    const url = URL.createObjectURL(file);
    try {
      const family = file.name.replace(/\.[^.]+$/, '');
      const face = new FontFace(family, `url("${url}")`);
      await face.load();
      document.fonts.add(face);
      fontFiles.current.push(url);
      setFonts(a => [...new Set([...a, family])]);
      setSettings(s => ({
        ...s,
        nameFont: s.nameFont || family,
        sponsors: (s.sponsors || []).map((line, index) => index === 0 && (!line.font || basicFonts.includes(line.font)) ? { ...line, font: family } : line),
      }));
      setFontStatus(`Loaded custom font: ${family}. Reupload after refreshing.`);
    } catch {
      URL.revokeObjectURL(url);
      setNotice('Could not load font file.');
    }
  }
  const changePlayer = (id, key, value) => setPlayers(ps => ps.map(p => p.id === id ? { ...p, [key]: key === 'size' ? (canonicalSize(value, settings.sizes) || value) : key === 'name' ? upper(value) : value } : p));
  const addPlayer = () => { setPlayers(ps => [{ id: Date.now(), name: '', number: '', size: '38', quantity: 1, sleeve: 'Half' }, ...ps]); setPlayerIndex(0); };
  const removePlayer = id => { setPlayers(ps => ps.filter(p => p.id !== id)); setPlayerIndex(0); };
  const updateSponsor = (id, patch) => setSettings(s => ({ ...s, sponsors: (s.sponsors || []).map(line => line.id === id ? { ...line, ...patch } : line) }));
  function openSponsorEditor(id, focusImmediately = false) {
    setActiveControl(`sponsor:${id}`);
    setTextWasSelected(true);
    setRightTool('text');
    setSettingsTab('text');
    setRightToolsOpen(true);
    sponsorFocusRef.current = focusImmediately ? null : id;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = document.getElementById(`js-sponsor-text-${id}`);
      target?.scrollIntoView({block:'center',behavior:'smooth'});
      if (focusImmediately) { target?.focus({preventScroll:true}); target?.select(); }
    }));
  }

  const addSponsor = () => {
    const line = sponsorTemplate(Date.now(), settings.nameFont || 'Arial');
    line.label = `Sponsor ${String((settings.sponsors || []).length + 1)}`;
    line.y = 12 + (settings.sponsors || []).length * 5;
    line.paperY = 10 + (settings.sponsors || []).length * 6;
    setSettings(s => ({ ...s, sponsorEnabled: true, sponsors: [...(s.sponsors || []), line] }));
    setActiveControl(`sponsor:${line.id}`);
  };
  const removeSponsor = id => setSettings(s => ({ ...s, sponsors: (s.sponsors || []).filter(line => line.id !== id) }));

  function applyImport(mode) {
    if (!importResults.length) { setNotice('No extracted players to import.'); return; }
    const normalized = importResults.map(p => ({ ...p, name: upper(p.name), size: canonicalSize(p.size, settings.sizes) || p.size }));
    setPlayers(current => mode === 'replace' ? normalized : [...current, ...normalized]);
    setPlayerIndex(0);
    setDrawer('players');
    setNotice(`${importResults.length} player records ${mode === 'replace' ? 'replaced the list' : 'added to the list'}. Review before print export.`);
    setImportResults([]);
  }
  function parsePastedText() {
    const records = parseTyped(importText, settings.editSize);
    setImportResults(records.map(p => ({ ...p, name: upper(p.name), size: canonicalSize(p.size, settings.sizes) || p.size })));
    setImportStatus(records.length ? `${records.length} rows parsed. Review them below before importing.` : 'No recognizable player records found. Try CSV columns: Name,Number,Size,Quantity,Sleeve');
  }
  async function importRosterFile(file) {
    if (!file) return;
    setImportBusy(true);
    setImportStatus(`Reading ${file.name}...`);
    setImportFileName(file.name);
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      let records = [];
      if (['xlsx', 'xls', 'csv'].includes(ext)) {
        const content = await file.arrayBuffer();
        const workbook = XLSX.read(content, { type: 'array', raw: true });
        if (!workbook.SheetNames.length) throw new Error('No worksheet found.');
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
        records = parseRows(rows, settings.editSize);
      } else if (['txt', 'tsv'].includes(ext)) {
        records = parseTyped(await file.text(), settings.editSize);
      } else if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
        setImportStatus('Scanning image with OCR. Handwriting may require corrections.');
        const result = await recognize(file, 'eng');
        const scanned = result.data.text || '';
        setImportText(scanned);
        records = parseTyped(scanned, settings.editSize);
      } else {
        throw new Error('Supported formats: .xlsx, .xls, .csv, .txt, .tsv, JPG, PNG, WebP, BMP. PDF import will be added later.');
      }
      setImportResults(records.map(p => ({ ...p, name: upper(p.name), size: canonicalSize(p.size, settings.sizes) || p.size })));
      setImportStatus(records.length ? `${records.length} records extracted from ${file.name}. Verify names, leading zeros, sizes and quantities.` : 'No records detected. Try a sheet with columns Name, Number, Size, Quantity, Sleeve.');
    } catch (error) {
      setImportResults([]);
      setImportStatus(`Import error: ${error.message}`);
    } finally { setImportBusy(false); }
  }

  const productionSettings = useMemo(()=>({...settings,sleeveChart}),[settings,sleeveChart]);
  const exportJobs = useMemo(() => {
    try { return { jobs: createProductionJobs(players, productionSettings, art), error: '' }; }
    catch (error) { return { jobs: [], error: error.message }; }
  }, [players, productionSettings, art]);


  async function downloadProductionZip() {
    if (exportBusy) return;
    setExportBusy(true);
    setExportProgress({ done: 0, total: exportJobs.jobs.length, label: 'Starting PNG production…' });
    try {
      const result = await exportProductionZip({ players, settings:productionSettings, artwork: art, dpi: exportDpi, onProgress: setExportProgress });
      setNotice(`ZIP ready: ${result.files} unique PNG files. Front PNGs are in the ZIP root; backs are in BACK NAME. Blank name/number rows are allowed now.`);
    } catch (error) {
      setNotice(`Export failed: ${error.message}`);
    } finally {
      setExportBusy(false);
    }
  }

  function csvDownload() {
    const rows = [['Name', 'Number', 'Size', 'Quantity', 'Sleeve'], ...players.map(p => [p.name, p.number, p.size, p.quantity, p.sleeve])];
    const csv = rows.map(r => r.map(x => '"' + String(x ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'jersey-players.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function updateDimension(key, value) { if (activeChart === 'Standard') { setNotice('Standard chart is fixed. Create a named chart to edit dimensions.'); return; } setSettings(s => ({ ...s, sizes: { ...s.sizes, [s.editSize]: { ...s.sizes[s.editSize], [key]: value } } })); }
  function addSize() { if (activeChart === 'Standard') { setNotice('Create a named chart before adding a custom size.'); return; } const answer = window.prompt('New size label (e.g. 52 or CUSTOM)'); if (!answer?.trim()) return; const key = canonicalSize(answer, settings.sizes) || answer.trim(); setSettings(s => ({ ...s, editSize: key, sizes: { ...s.sizes, [key]: s.sizes[key] || { width: 21, height: 29 } } })); }
  function createChart() { const raw = window.prompt('Name your new size chart (for example ZS Digital)'); const name = raw?.trim(); if (!name) return; if (Object.keys(chartNames).some(n => n.toLowerCase() === name.toLowerCase())) { setNotice('That chart name already exists.'); return; } const copy = structuredClone(settings.sizes); setChartNames(c => ({ ...c, [name]: copy })); setActiveChart(name); setNotice(`Created size chart: ${name}`); }
  function deleteChart() { if (activeChart === 'Standard') return; if (!window.confirm(`Delete size chart ${activeChart}?`)) return; setChartNames(c => { const next = { ...c }; delete next[activeChart]; return next; }); setActiveChart('Standard'); }
  const clearPlayers = () => { if (window.confirm(`Remove all ${players.length} players?`)) { setPlayers([]); setPlayerIndex(0); } };
  const previewSleeveSource = (which) => art[which === 'left' ? 'leftSleeve' : 'rightSleeve'] || art[currentSleeveType === 'Half' ? 'halfSleeve' : 'fullSleeve'] || art[which === 'left' ? 'rightSleeve' : 'leftSleeve'];
  const mirrorPreviewSleeve = which => !art[which === 'left' ? 'leftSleeve' : 'rightSleeve'] && Boolean(art[which === 'left' ? 'rightSleeve' : 'leftSleeve'] || art[currentSleeveType === 'Half' ? 'halfSleeve' : 'fullSleeve']);
  function resetPosition() {
    setSettings(s => ({
      ...s,
      nameX: 50,
      nameY: 24,
      numberX: 50,
      numberY: 51,
      paperNameX: 50,
      paperNameY: 84,
      paperNumberX: 50,
      paperNumberY: 34,
      frontNumberX: 50,
      frontNumberY: 36,
      sponsors: (s.sponsors || []).map((line, index) => ({ ...line, x: 50, y: 12 + index * 5, paperX: 50, paperY: 10 + index * 6 })),
    }));
  }

  function resetNameSettings() {
    setSettings(s => ({
      ...s,
      namePoints: initialSettings.namePoints,
      nameWidth: initialSettings.nameWidth,
      nameFill: initialSettings.nameFill,
      nameStroke: initialSettings.nameStroke,
      nameOutlineWidth: initialSettings.nameOutlineWidth,
      nameCurve: initialSettings.nameCurve,
      nameGradientEnabled: initialSettings.nameGradientEnabled,
      nameGradientStart: initialSettings.nameGradientStart,
      nameGradientEnd: initialSettings.nameGradientEnd,
      nameGradientDirection: initialSettings.nameGradientDirection,
      nameShadowEnabled: initialSettings.nameShadowEnabled,
      nameShadowColor: initialSettings.nameShadowColor,
      nameShadowBlur: initialSettings.nameShadowBlur,
      nameShadowOffsetX: initialSettings.nameShadowOffsetX,
      nameShadowOffsetY: initialSettings.nameShadowOffsetY,
      nameX: initialSettings.nameX,
      nameY: initialSettings.nameY,
      paperNameX: initialSettings.paperNameX,
      paperNameY: initialSettings.paperNameY,
    }));
  }

  function resetNumberSettings() {
    setSettings(s => ({
      ...s,
      numberPoints: initialSettings.numberPoints,
      numberWidth: initialSettings.numberWidth,
      numberFill: initialSettings.numberFill,
      numberStroke: initialSettings.numberStroke,
      numberOutlineWidth: initialSettings.numberOutlineWidth,
      numberCurve: initialSettings.numberCurve,
      numberGradientEnabled: initialSettings.numberGradientEnabled,
      numberGradientStart: initialSettings.numberGradientStart,
      numberGradientEnd: initialSettings.numberGradientEnd,
      numberGradientDirection: initialSettings.numberGradientDirection,
      numberShadowEnabled: initialSettings.numberShadowEnabled,
      numberShadowColor: initialSettings.numberShadowColor,
      numberShadowBlur: initialSettings.numberShadowBlur,
      numberShadowOffsetX: initialSettings.numberShadowOffsetX,
      numberShadowOffsetY: initialSettings.numberShadowOffsetY,
      numberX: initialSettings.numberX,
      numberY: initialSettings.numberY,
      paperNumberX: initialSettings.paperNumberX,
      paperNumberY: initialSettings.paperNumberY,
      frontNumberX: initialSettings.frontNumberX,
      frontNumberY: initialSettings.frontNumberY,
      frontNumberWidth: initialSettings.frontNumberWidth,
      frontNumberPoints: initialSettings.frontNumberPoints,
    }));
  }
  function adjustPosition(axis, value) {
    if (grouped && ['name', 'number'].includes(activeControl)) {
      setSettings(s => ({
        ...s,
        nameX: axis === 'x' ? Math.max(0, Math.min(100, s.nameX + value)) : s.nameX,
        nameY: axis === 'y' ? Math.max(0, Math.min(100, s.nameY + value)) : s.nameY,
        numberX: axis === 'x' ? Math.max(0, Math.min(100, s.numberX + value)) : s.numberX,
        numberY: axis === 'y' ? Math.max(0, Math.min(100, s.numberY + value)) : s.numberY,
      }));
      return;
    }
    if (activeControl === 'name' || activeControl === 'number' || activeControl === 'frontNumber' || activeControl === 'paperName' || activeControl === 'paperNumber') {
      const key = `${activeControl}${axis.toUpperCase()}`;
      setSettings(s => ({ ...s, [key]: Math.max(0, Math.min(100, Number(s[key] ?? 50) + value)) }));
      return;
    }
    if (activeControl.startsWith('paperSponsor:')) {
      const id = Number(activeControl.split(':')[1]);
      setSettings(s => ({
        ...s,
        sponsors: (s.sponsors || []).map(line => line.id !== id ? line : {
          ...line,
          paperX: axis === 'x' ? Math.max(0, Math.min(100, Number(line.paperX ?? 50) + value)) : (line.paperX ?? 50),
          paperY: axis === 'y' ? Math.max(0, Math.min(100, Number(line.paperY ?? 10) + value)) : (line.paperY ?? 10),
        }),
      }));
      return;
    }
    if (activeControl.startsWith('sponsor:')) {
      const id = Number(activeControl.split(':')[1]);
      updateSponsor(id, axis === 'x'
        ? { x: Math.max(0, Math.min(100, (activeSponsor?.x ?? 50) + value)) }
        : { y: Math.max(0, Math.min(100, (activeSponsor?.y ?? 12) + value)) });
    }
  }
  // Canvas-only shortcuts: never hijack typing in inputs, selects or textareas.
  useEffect(() => {
    const handler = event => {
      if (!event.ctrlKey || event.altKey || event.metaKey || !textWasSelected || !['back', 'front'].includes(side)) return;
      const el = event.target;
      if (el?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      const code = event.key.toLowerCase();
      if (!['c','e','p'].includes(code)) return;
      event.preventDefault();
      const centeredX = code === 'c' || code === 'p';
      const centeredY = code === 'e' || code === 'p';
      const clamp = n => Math.max(0, Math.min(100, Number(n) || 0));
      setSettings(previous => {
        if (activeControl.startsWith('sponsor:')) {
          const id = Number(activeControl.split(':')[1]);
          return { ...previous, sponsors: (previous.sponsors || []).map(s => s.id === id ? {
            ...s, x: centeredX ? 50 : clamp(s.x ?? 50), y: centeredY ? 50 : clamp(s.y ?? 12)
          } : s) };
        }
        if (!['name','number','frontNumber'].includes(activeControl)) return previous;
        return { ...previous,
          [`${activeControl}X`]: centeredX ? 50 : previous[`${activeControl}X`],
          [`${activeControl}Y`]: centeredY ? 50 : previous[`${activeControl}Y`],
        };
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [textWasSelected, activeControl, side]);

  // Native non-passive wheel listener suppresses browser Ctrl+wheel zoom over the editor.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const bounds = stage.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      setPreviewZoom(old => {
        const next = Math.max(50, Math.min(300, Math.round(old - Math.sign(event.deltaY) * 10)));
        if (next !== old) {
          const ratio = next / old;
          requestAnimationFrame(() => {
            stage.scrollLeft = (stage.scrollLeft + pointerX) * ratio - pointerX;
            stage.scrollTop = (stage.scrollTop + pointerY) * ratio - pointerY;
          });
        }
        return next;
      });
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    return () => stage.removeEventListener('wheel', wheel);
  }, []);

  function startDrag(key, e) {
    if (!svgRef.current) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    dragRef.current = {
      key,
      startX: e.clientX,
      startY: e.clientY,
      width: rect.width,
      height: rect.height,
      initial: {
        nameX: settings.nameX, nameY: settings.nameY,
        numberX: settings.numberX, numberY: settings.numberY,
        paperNameX: settings.paperNameX ?? 50, paperNameY: settings.paperNameY ?? 84,
        paperNumberX: settings.paperNumberX ?? 50, paperNumberY: settings.paperNumberY ?? 34,
        frontNumberX: settings.frontNumberX, frontNumberY: settings.frontNumberY,
        sponsors: (settings.sponsors || []).map(line => ({ id: line.id, x: line.x, y: line.y, paperX: line.paperX ?? 50, paperY: line.paperY ?? 10 })),
      },
    };
    try { svg.setPointerCapture(e.pointerId); } catch { }
  }
  function dragMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / Math.max(d.width, 1) * 100;
    const dy = (e.clientY - d.startY) / Math.max(d.height, 1) * 100;
    // Shift + drag locks the selected text onto its original horizontal or vertical line.
    const lockX = e.shiftKey && Math.abs(e.clientX-d.startX) < Math.abs(e.clientY-d.startY);
    const lockY = e.shiftKey && !lockX;
    const ownSponsorId = String(d.key).startsWith('sponsor:') ? Number(String(d.key).split(':')[1]) : null;
    const otherSponsors = (settings.sponsors || []).filter(line => line.id !== ownSponsorId);
    const xAnchors = [50, 0, 100,
      ...(d.key === 'name' ? [] : [Number(settings.nameX)]),
      ...(d.key === 'number' ? [] : [Number(settings.numberX)]),
      ...otherSponsors.map(line => Number(line.x ?? 50))];
    const yAnchors = [50, 0, 100,
      ...(d.key === 'name' ? [] : [Number(settings.nameY)]),
      ...(d.key === 'number' ? [] : [Number(settings.numberY)]),
      ...otherSponsors.map(line => Number(line.y ?? 12))];
    function snap(value, anchors, axis) {
      if (!settings.smartGuidesEnabled) return value;
      const source = anchors.filter(x => Number.isFinite(x));
      const hit = source.find(x => Math.abs(x - value) <= 1.1);
      return hit == null ? value : hit;
    }
    const clamp = value => Math.max(0, Math.min(100, value));
    const snapX = value => clamp(snap(value, xAnchors, 'x'));
    const snapY = value => clamp(snap(value, yAnchors, 'y'));
    const track = (x, y) => setGuideLines(settings.smartGuidesEnabled ? {x: xAnchors.some(p => Math.abs(p-x)<0.01) ? x : null,
      y:yAnchors.some(p => Math.abs(p-y)<0.01) ? y : null} : {x:null,y:null});
    if (grouped && ['name', 'number'].includes(d.key)) {
      const x = snapX(d.initial[`${d.key}X`] + (lockX ? 0 : dx));
      const y = snapY(d.initial[`${d.key}Y`] + (lockY ? 0 : dy));
      const ddx = x - d.initial[`${d.key}X`], ddy = y - d.initial[`${d.key}Y`];
      track(x,y);
      setSettings(old => ({ ...old,
        nameX: clamp(d.initial.nameX + ddx), nameY: clamp(d.initial.nameY + ddy),
        numberX: clamp(d.initial.numberX + ddx), numberY: clamp(d.initial.numberY + ddy),
      }));
      return;
    }
    if (d.key === 'name' || d.key === 'number' || d.key === 'frontNumber' || d.key === 'paperName' || d.key === 'paperNumber') {
      const prefix = d.key;
      const x = snapX(d.initial[`${prefix}X`] + (lockX ? 0 : dx));
      const y = snapY(d.initial[`${prefix}Y`] + (lockY ? 0 : dy));
      track(x,y);
      setSettings(old => ({ ...old, [`${prefix}X`]: x, [`${prefix}Y`]: y }));
      return;
    }
    if (String(d.key).startsWith('paperSponsor:')) {
      const id = Number(String(d.key).split(':')[1]);
      setSettings(old => ({
        ...old,
        sponsors: (old.sponsors || []).map(line => {
          if (line.id !== id) return line;
          const initial = d.initial.sponsors.find(x => x.id === id) || { paperX: line.paperX ?? 50, paperY: line.paperY ?? 10 };
          return { ...line, paperX: Math.max(0, Math.min(100, (initial.paperX ?? 50) + (lockX ? 0 : dx))), paperY: Math.max(0, Math.min(100, (initial.paperY ?? 10) + (lockY ? 0 : dy))) };
        }),
      }));
      return;
    }
    if (String(d.key).startsWith('sponsor:')) {
      const id = Number(String(d.key).split(':')[1]);
      const initial = d.initial.sponsors.find(x => x.id === id) || { x: 50, y: 12 };
      const x = snapX(Number(initial.x ?? 50) + (lockX ? 0 : dx));
      const y = snapY(Number(initial.y ?? 12) + (lockY ? 0 : dy));
      track(x,y);
      setSettings(old => ({
        ...old,
        sponsors: (old.sponsors || []).map(line => line.id === id ? { ...line, x, y } : line),
      }));
    }
  }
  function finishDrag(e) {
    const d = dragRef.current;
    setGuideLines({x:null,y:null});dragRef.current = null;
    try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { }
    const id = sponsorFocusRef.current;
    sponsorFocusRef.current = null;
    if (id != null && d && Math.hypot(e.clientX-d.startX,e.clientY-d.startY) < 5) {
      requestAnimationFrame(() => {
        const target = document.getElementById(`js-sponsor-text-${id}`);
        target?.focus({preventScroll:true});target?.select();
      });
    }
  }

  const fontOption = (value, setter) => <select value={value} onChange={e => setter(e.target.value)} style={{ fontFamily: value }}>{!fonts.includes(value) && <option value={value}>{value}</option>}{fonts.map(f => <option key={f} value={f}>{f}</option>)}</select>;
  const positionBar = (label, value, onChange) => <label className="range-field"><span>{label}<b>{value}%</b></span><input type="range" min="0" max="100" value={value} onChange={e => onChange(Number(e.target.value))} /></label>;

  const textEffectControls = (prefix, current, setCurrent, fontKey = null, resetAll = null) => <>
    {fontKey && <label className="field">Font{fontOption(current[fontKey], v => setCurrent({ [fontKey]: v }))}</label>}
    <div className="two-cols">
      {'points' in current && <Field label="Font size (pt)" value={current.points} onChange={v => setCurrent({ points: v })} />}
      {'width' in current && <Field label="Max width (in)" value={current.width} step={.25} onChange={v => setCurrent({ width: v })} />}
      {'fill' in current && <ColorField label="Fill" value={current.fill} onChange={v => setCurrent({ fill: v })} />}
      {'stroke' in current && <ColorField label="Outline color" value={current.stroke} onChange={v => setCurrent({ stroke: v })} />}
      {'outlineWidth' in current && <Field label="Outline width" step={.25} value={current.outlineWidth} onChange={v => setCurrent({ outlineWidth: v })} />}
      {'curve' in current && <div className="curve-control"><div className="curve-header"><span>Curve</span><strong>{Number(current.curve) || 0}</strong><button type="button" className="curve-reset" onClick={() => setCurrent({curve:0})}>Reset to 0</button></div><input aria-label={`${prefix} curve`} type="range" min="-80" max="80" step="1" value={Number(current.curve) || 0} onChange={e => setCurrent({curve:Number(e.target.value)})}/><div className="curve-fine"><button type="button" onClick={() => setCurrent({curve:Math.max(-80,(Number(current.curve)||0)-1)})}>−1</button><input aria-label={`${prefix} curve value`} type="number" min="-80" max="80" step="1" value={Number(current.curve)||0} onChange={e => setCurrent({curve:Math.max(-80,Math.min(80,Math.round(Number(e.target.value)||0)))})}/><button type="button" onClick={() => setCurrent({curve:Math.min(80,(Number(current.curve)||0)+1)})}>+1</button></div></div>}
    </div>
    <label className="check"><input type="checkbox" checked={!!current.gradientEnabled} onChange={e => setCurrent({ gradientEnabled: e.target.checked })} />Enable gradient</label>
    {current.gradientEnabled && <div className="effect-grid">
      <ColorField label="Gradient start" value={current.gradientStart} onChange={v => setCurrent({ gradientStart: v })} />
      <ColorField label="Gradient end" value={current.gradientEnd} onChange={v => setCurrent({ gradientEnd: v })} />
      <label className="field"><span>Gradient direction</span><select value={current.gradientDirection} onChange={e => setCurrent({ gradientDirection: e.target.value })}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label>
    </div>}
    <label className="check"><input type="checkbox" checked={!!current.shadowEnabled} onChange={e => setCurrent({ shadowEnabled: e.target.checked })} />Enable shadow</label>
    {current.shadowEnabled && <div className="effect-grid">
      <ColorField label="Shadow color" value={current.shadowColor} onChange={v => setCurrent({ shadowColor: v })} />
      <Field label="Shadow blur" step={.25} value={current.shadowBlur} onChange={v => setCurrent({ shadowBlur: v })} />
      <Field label="Shadow X" step={.25} min={-50} value={current.shadowOffsetX} onChange={v => setCurrent({ shadowOffsetX: v })} />
      <Field label="Shadow Y" step={.25} min={-50} value={current.shadowOffsetY} onChange={v => setCurrent({ shadowOffsetY: v })} />
    </div>}
    {resetAll && <button type="button" className="subtle full reset-effect-button" onClick={resetAll}>Reset all {prefix} settings</button>}
  </>;

  const nameConfig = {
    font: settings.nameFont,
    points: settings.namePoints,
    width: settings.nameWidth,
    fill: settings.nameFill,
    stroke: settings.nameStroke,
    outlineWidth: settings.nameOutlineWidth,
    curve: settings.nameCurve,
    gradientEnabled: settings.nameGradientEnabled,
    gradientStart: settings.nameGradientStart,
    gradientEnd: settings.nameGradientEnd,
    gradientDirection: settings.nameGradientDirection,
    shadowEnabled: settings.nameShadowEnabled,
    shadowColor: settings.nameShadowColor,
    shadowBlur: settings.nameShadowBlur,
    shadowOffsetX: settings.nameShadowOffsetX,
    shadowOffsetY: settings.nameShadowOffsetY,
  };
  const numberConfig = {
    font: settings.numberFont,
    points: settings.numberPoints,
    width: settings.numberWidth,
    fill: settings.numberFill,
    stroke: settings.numberStroke,
    outlineWidth: settings.numberOutlineWidth,
    curve: settings.numberCurve,
    gradientEnabled: settings.numberGradientEnabled,
    gradientStart: settings.numberGradientStart,
    gradientEnd: settings.numberGradientEnd,
    gradientDirection: settings.numberGradientDirection,
    shadowEnabled: settings.numberShadowEnabled,
    shadowColor: settings.numberShadowColor,
    shadowBlur: settings.numberShadowBlur,
    shadowOffsetX: settings.numberShadowOffsetX,
    shadowOffsetY: settings.numberShadowOffsetY,
  };

  // Contextual controls reuse the same existing text settings as the Properties panel.
  // The canvas geometry, preset values and production export engine remain unchanged.
  const selectedTextType = side === 'front' && settings.frontNumber && String(player?.number || '').trim() ? 'frontNumber' :
    side === 'back' && (activeControl === 'name' || activeControl === 'number' || activeControl.startsWith('sponsor:')) ? activeControl : null;
  const isNameSelected = selectedTextType === 'name';
  const isNumberSelected = selectedTextType === 'number' || selectedTextType === 'frontNumber';
  const selectedSponsor = selectedTextType?.startsWith('sponsor:') ? sponsorLayers.find(line => `sponsor:${line.id}` === selectedTextType) : null;
  const currentTextLabel = isNameSelected ? 'Player name' : isNumberSelected ? 'Player number' : selectedSponsor ? 'Sponsor text' : '';
  const currentFont = selectedSponsor ? (selectedSponsor.font || settings.nameFont) : isNameSelected ? settings.nameFont : settings.numberFont;
  const currentPoints = selectedSponsor ? Number(selectedSponsor.points ?? 160) : isNameSelected ? Number(settings.namePoints) : selectedTextType === 'frontNumber' ? Number(settings.frontNumberPoints) : Number(settings.numberPoints);
  const currentWidth = selectedSponsor ? Number(selectedSponsor.width ?? 12) : isNameSelected ? Number(settings.nameWidth) : selectedTextType === 'frontNumber' ? Number(settings.frontNumberWidth) : Number(settings.numberWidth);
  const currentFill = selectedSponsor ? (selectedSponsor.fill || '#ffffff') : isNameSelected ? settings.nameFill : settings.numberFill;
  const currentTextX = selectedSponsor ? Number(selectedSponsor.x ?? 50) : isNameSelected ? Number(settings.nameX) : selectedTextType === 'frontNumber' ? Number(settings.frontNumberX) : Number(settings.numberX);
  const currentTextY = selectedSponsor ? Number(selectedSponsor.y ?? 12) : isNameSelected ? Number(settings.nameY) : selectedTextType === 'frontNumber' ? Number(settings.frontNumberY) : Number(settings.numberY);
  function quickTextChange(patch) {
    if (selectedSponsor) { updateSponsor(selectedSponsor.id, patch); return; }
    const stem = isNameSelected ? 'name' : 'number';
    setSettings(previous => {
      const next = {...previous};
      for (const [property, value] of Object.entries(patch)) {
        const key = property === 'font' ? `${stem}Font` : property === 'points' ? selectedTextType === 'frontNumber' ? 'frontNumberPoints' : `${stem}Points` : property === 'width' ? selectedTextType === 'frontNumber' ? 'frontNumberWidth' : `${stem}Width` : property === 'fill' ? `${stem}Fill` : property === 'x' ? selectedTextType === 'frontNumber' ? 'frontNumberX' : `${stem}X` : property === 'y' ? selectedTextType === 'frontNumber' ? 'frontNumberY' : `${stem}Y` : null;
        if (key) next[key] = value;
      }
      return next;
    });
  }
  function openRightTool(tool) {
    if (tool === 'export') { setExportReviewOpen(true); return; }
    if (rightToolsOpen && rightTool === tool) { setRightToolsOpen(false); return; }
    setRightTool(tool);
    setSettingsTab(['text','fonts','effects','layers'].includes(tool) ? 'text' : tool === 'layout' ? 'layout' : 'parts');
    setRightToolsOpen(true);
    if (tool === 'fonts' || tool === 'effects' || tool === 'layers') {
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(tool === 'fonts' ? 'js-fonts-section' : tool === 'effects' ? 'js-text-effects-section' : 'js-sponsor-section')?.scrollIntoView({block:'start',behavior:'smooth'})));
    }
  }

  return <div className="app">
    <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
      <div className="brand"><span className="brand-symbol">JS</span>{sidebarOpen && <span><strong>JERSEY STUDIO</strong><small>SUBLIMATION WORKSPACE</small></span>}</div>
      <button className="sidebar-toggle" onClick={() => setSidebarOpen(v => !v)} title={sidebarOpen ? 'Collapse workspace menu' : 'Expand workspace menu'}>{sidebarOpen ? '❮' : '❯'}<span>{sidebarOpen ? ' Hide menu' : ''}</span></button>
      <nav>
        <button className={workspace === 'sizing' ? 'active' : ''} title="Jersey Sizing" onClick={() => setWorkspace('sizing')}><span>▦</span>{sidebarOpen && 'Jersey Sizing'}</button>
        <button className={workspace === 'vector' ? 'active' : ''} title="Image to Vector" onClick={() => setWorkspace('vector')}><span>✧</span>{sidebarOpen && 'Image to Vector'}</button>
      </nav>
      {sidebarOpen && <p className="sidebar-foot">PHASE 3.2 · PNG PRODUCTION<br />Dynamic fitting, sponsor layers and optional blank personalization enabled.</p>}
    </aside>
    <section className="content">
      <header className="topbar"><div><span className="overline">JERSEY STUDIO / {workspace === 'sizing' ? 'SIZING' : 'VECTOR'}</span><h1>{workspace === 'sizing' ? 'Production Workspace' : 'Image to Vector'}</h1></div><button type="button" className="top-export-button" disabled={workspace!=='sizing' || Boolean(exportJobs.error)} onClick={()=>setExportReviewOpen(true)}>↗ Review &amp; Export</button></header>
      {notice && <div className="notice" onClick={() => setNotice('')}>{notice}<span> ×</span></div>}
      {exportReviewOpen && <ExportReview jobs={exportJobs.jobs} players={players} settings={productionSettings} artwork={art} dpi={exportDpi} onClose={()=>setExportReviewOpen(false)}/>}
      {workspace === 'vector' ? <VectorWorkspace /> : <>
        <div className="workbench">
          <section className="asset-panel panel">
            <div className="panel-heading"><h2>Assets & data</h2><span className="tiny-tag">PROJECT</span></div>
            <div className="tabbar"><button className={drawer === 'artwork' ? 'selected' : ''} onClick={() => setDrawer('artwork')}>Artwork</button><button className={drawer === 'import' ? 'selected' : ''} onClick={() => setDrawer('import')}>Import</button><button className={drawer === 'players' ? 'selected' : ''} onClick={() => setDrawer('players')}>Players <small>{players.length}</small></button></div>
            {drawer === 'import' ? <div className="import-panel"><h3>Import player roster</h3><p className="helper">Upload Excel (.xlsx / .xls), CSV, typed TXT, or an image of a handwritten or printed list. OCR is not guaranteed to read handwriting correctly.</p><label className="subtle full roster-upload">{importBusy ? 'Reading file...' : '↑ Choose roster file'}<input hidden type="file" disabled={importBusy} accept=".xlsx,.xls,.csv,.txt,.tsv,.png,.jpg,.jpeg,.webp,.bmp" onChange={e => { importRosterFile(e.target.files?.[0]); e.target.value = ''; }} /></label>{importFileName && <p className="helper">File: {importFileName}</p>}<div className="divider" /><h3>Or paste/type a list</h3><textarea rows={7} placeholder={'Name,Number,Size,Quantity,Sleeve\nRAHUL,07,38,2,Half\nAMAN,10,40,1,Full'} value={importText} onChange={e => setImportText(e.target.value)} /><button className="subtle full" disabled={importBusy} onClick={parsePastedText}>Parse typed list</button>{importStatus && <p className="import-status">{importStatus}</p>}{importResults.length > 0 && <><h3>Review extracted players ({importResults.length})</h3><div className="import-review">{importResults.map((p, i) => <div className="import-record" key={p.id}><label>Name<input value={p.name} onChange={e => setImportResults(rs => rs.map((r, j) => i === j ? { ...r, name: upper(e.target.value) } : r))} /></label><label>No<input value={p.number} onChange={e => setImportResults(rs => rs.map((r, j) => i === j ? { ...r, number: e.target.value } : r))} /></label><label>Size<input value={p.size} onChange={e => setImportResults(rs => rs.map((r, j) => i === j ? { ...r, size: e.target.value } : r))} /></label><label>Qty<input type="number" min="1" value={p.quantity} onChange={e => setImportResults(rs => rs.map((r, j) => i === j ? { ...r, quantity: Math.max(1, Number(e.target.value) || 1) } : r))} /></label><label>Sleeve<select value={p.sleeve} onChange={e => setImportResults(rs => rs.map((r, j) => i === j ? { ...r, sleeve: e.target.value } : r))}><option>Half</option><option>Full</option></select></label><button title="Remove extracted row" onClick={() => setImportResults(rs => rs.filter((_, j) => j !== i))}>×</button></div>)}</div><div className="import-actions"><button onClick={() => applyImport('replace')}>Replace player list</button><button onClick={() => applyImport('append')}>Add to player list</button></div></>}</div> : drawer === 'artwork' ? <div className="asset-list">{uploadTypes.map(([key, label]) => <div className="asset-with-delete" key={key}><label className="asset-upload"><span className="thumb">{art[key] ? <img src={art[key]} alt="" /> : '＋'}</span><span><strong>{label}</strong><small>{art[key] ? 'Replace image' : 'Select artwork'}</small></span><span className="upload-arrow">↗</span><input hidden type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.tif,.tiff" onChange={e => { readImage(e.target.files?.[0], src => setArt(a => ({ ...a, [key]: src }))); e.target.value = ''; }} /></label>{art[key] && <button className="asset-delete" title={`Remove ${label} artwork`} onClick={() => setArt(a => { const next = { ...a }; delete next[key]; return next; })}>🗑</button>}</div>)}<p className="helper">All artwork inputs are optional. Uploaded images remain in memory until you refresh.</p></div> : <div className="player-list"><div className="side-tools"><button className="subtle" onClick={addPlayer}>＋ Add player</button><button className="subtle" onClick={csvDownload}>↓ CSV</button><button className="subtle danger" onClick={clearPlayers}>🗑 Clear all</button></div>{players.map((p, i) => <div className={`player-card ${playerIndex === i ? 'current' : ''}`} key={p.id}><button className="player-pick" onClick={() => setPlayerIndex(i)}><strong>{p.name || 'Unnamed'}</strong><span>#{p.number || '—'} · {sizeLabel(canonicalSize(p.size, settings.sizes) || p.size)} · Q{p.quantity}</span></button><button className="trash" title="Remove player" onClick={() => removePlayer(p.id)}>×</button><div className="player-fields"><label>Name<input value={p.name} onChange={e => changePlayer(p.id, 'name', e.target.value)} /></label><label>Number<input value={p.number} onChange={e => changePlayer(p.id, 'number', e.target.value)} /></label><label>Size<select value={p.size} onChange={e => changePlayer(p.id, 'size', e.target.value)}>{!settings.sizes[canonicalSize(p.size, settings.sizes) || p.size] && <option value={p.size}>⚠ Unknown: {p.size}</option>}{sizes.map(s => <option key={s} value={s}>{sizeLabel(s)}</option>)}</select></label><label>Qty<input type="number" min="1" value={p.quantity} onChange={e => changePlayer(p.id, 'quantity', Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></label><label className="wide">Sleeve<select value={p.sleeve} onChange={e => changePlayer(p.id, 'sleeve', e.target.value)}><option>Half</option><option>Full</option></select></label></div></div>)}<p className="helper">{players.length} records · {counts} total jerseys. Name and number can now be left blank if required.</p></div>}
          </section>
          <section className="center-area">
            {textWasSelected && selectedTextType && player && <div className="selection-toolbar" aria-label={`${currentTextLabel} quick formatting`}>
              <span className="selection-chip">{currentTextLabel}</span>
              <label className="selection-field selection-font" title="Font family">Font
                <select aria-label="Quick font family" value={currentFont} onChange={e => quickTextChange({font:e.target.value})}>
                  {!fonts.includes(currentFont) && <option value={currentFont}>{currentFont}</option>}
                  {fonts.map(font => <option key={font} value={font}>{font}</option>)}
                </select>
              </label>
              <label className="selection-field selection-size" title="Font size in points">pt
                <input aria-label="Quick font size" type="number" min="1" step="1" value={currentPoints} onChange={e => quickTextChange({points:Math.max(1,Number(e.target.value)||1)})}/>
              </label>
              <label className="selection-color" title="Text fill color"><input aria-label="Quick text color" type="color" value={currentFill} onChange={e => quickTextChange({fill:e.target.value})}/></label>
              <button type="button" className="selection-action" onClick={() => openRightTool('effects')} title="Open existing effects controls">✧ Effects</button>
              <label className="selection-field selection-dimension" title="Maximum text width in inches">W
                <input aria-label="Quick max text width inches" type="number" min="0.1" step="0.25" value={currentWidth} onChange={e => quickTextChange({width:Math.max(.1,Number(e.target.value)||.1)})}/><span>in</span>
              </label>
              <span className="selection-field selection-autoheight" title="Text height is determined by the chosen font and point size">H auto</span>
              <button type="button" className="selection-action" onClick={() => quickTextChange({x:50})} title="Align text to horizontal center">↔ Center</button>
              <button type="button" className="selection-action" onClick={() => quickTextChange({y:50})} title="Align text to vertical center">↕ Center</button>
              <span className="selection-location" title="Text anchor position">X {currentTextX.toFixed(0)}% · Y {currentTextY.toFixed(0)}%</span>
            </div>}
            <div className="canvas-toolbar"><div className="segmented">
              {[["back","Back"],["front","Front"],["halfSleeve","Half sleeve"],["fullSleeve","Full sleeve"],["collar","Collar"]].map(([key,label])=><button key={key} className={side===key?'selected':''} onClick={()=>setSide(key)}>{label}</button>)}
            </div><div className="preview-toolbar-right"><div className="preview-zoom-controls" title="Hold Ctrl and scroll over the canvas to zoom"><button type="button" aria-label="Zoom out" onClick={()=>setPreviewZoom(z=>Math.max(50,z-10))}>−</button><span>{previewZoom}%</span><button type="button" aria-label="Zoom in" onClick={()=>setPreviewZoom(z=>Math.min(300,z+10))}>+</button><button type="button" onClick={()=>setPreviewZoom(100)}>Reset</button></div>{side==='back'&&<label className="paper-export-switch"><input type="checkbox" checked={settings.backPaperEnabled!==false} onChange={e=>set('backPaperEnabled',e.target.checked)}/> Include paper print in ZIP</label>}<span>{sleeveView ? `${sleeveViewDims.width} × ${sleeveViewDims.height} in (each side)` : side==='collar'?`${settings.collarWidth} × ${settings.collarHeight} in`:`${realWidth} × ${realHeight} in`}</span></div></div>
            <div className="stage ruler-stage" ref={stageRef} onPointerDown={startPan}>
              <div className="ruler-preview-area" style={{zoom:previewZoom/100,'--page-ruler-width':sleeveView?sleeveViewDims.width*2+sleeveGap:side==='collar'?settings.collarWidth:realWidth,'--page-ruler-height':sleeveView?sleeveViewDims.height:side==='collar'?settings.collarHeight:realHeight}}>
                <div className="ruler-corner">in</div>
                <div className="inch-ruler inch-ruler-top">{Array.from({length:Math.floor(sleeveView?sleeveViewDims.width*2+sleeveGap:side==='collar'?settings.collarWidth:realWidth)+1},(_,i)=><span key={i} style={{left:`${i/Math.max(1,sleeveView?sleeveViewDims.width*2+sleeveGap:side==='collar'?settings.collarWidth:realWidth)*100}%`}}>{i}</span>)}</div>
                <div className="inch-ruler inch-ruler-left">{Array.from({length:Math.floor(sleeveView?sleeveViewDims.height:side==='collar'?settings.collarHeight:realHeight)+1},(_,i)=><span key={i} style={{top:`${i/Math.max(1,sleeveView?sleeveViewDims.height:side==='collar'?settings.collarHeight:realHeight)*100}%`}}>{i}</span>)}</div>
                <div className={`print-canvas ${sleeveView?'paired-sleeve-preview':''}`} style={{aspectRatio: side==='collar'?`${settings.collarWidth}/${settings.collarHeight}`:sleeveView?`${sleeveViewDims.width*2+sleeveGap}/${sleeveViewDims.height}`:`${realWidth}/${realHeight}`,height:'min(63vh, 610px)',width:'auto',maxWidth:'calc(100% - 30px)'}}>
                  {sleeveView ? <div className="paired-pieces">
                    {['left','right'].map(which=>{const src=art[`${which}${sleeveViewType}Sleeve`]||art[sleeveViewType==='Full'?'fullSleeve':'halfSleeve']||art[`${which}Sleeve`]||art[`${which==='left'?'right':'left'}${sleeveViewType}Sleeve`]; const mirrored=!art[`${which}${sleeveViewType}Sleeve`]&&!art[sleeveViewType==='Full'?'fullSleeve':'halfSleeve']&&!art[`${which}Sleeve`];return <div className="paired-piece" key={which} style={{width:`${sleeveViewDims.width/(sleeveViewDims.width*2+sleeveGap)*100}%`}}>{src?<img src={src} alt={`${which} ${sleeveViewType} sleeve`} style={{transform:mirrored?'scaleX(-1)':'none'}}/>:<span>Upload {which} {sleeveViewType.toLowerCase()} sleeve</span>}<b>{which.toUpperCase()} · {sleeveViewDims.width} × {sleeveViewDims.height} in</b></div>})}
                  </div> : image ? <img className="base-art" src={image} alt={`${side} uploaded artwork`} /> : <div className="canvas-empty">Upload {side} artwork<small>The full production page appears here</small></div>}
              <svg ref={svgRef} style={{display:side==='back'||side==='front'?undefined:'none'}} className="template-overlay" onPointerDown={e => { if(e.target === e.currentTarget) setTextWasSelected(false); }} viewBox={`0 0 ${realWidth * u} ${realHeight * u}`} preserveAspectRatio="none" onPointerMove={dragMove} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
                {settings.smartGuidesEnabled && dragRef.current && (side === 'back' || side === 'front') && <g pointerEvents="none" className="smart-guide-lines">
                  {guideLines.x != null && <line x1={guideLines.x * realWidth * u / 100} y1="0" x2={guideLines.x * realWidth * u / 100} y2={realHeight*u} stroke={settings.smartGuideColor || '#00f0ff'} strokeWidth="2.4" strokeDasharray="10 7" />}
                  {guideLines.y != null && <line x1="0" y1={guideLines.y * realHeight * u / 100} x2={realWidth*u} y2={guideLines.y * realHeight * u / 100} stroke={settings.smartGuideColor || '#00f0ff'} strokeWidth="2.4" strokeDasharray="10 7" />}
                </g>}
                {(side === 'back' || side === 'front') && settings.topMarkEnabled && <rect x={(realWidth * u) / 2 - scaledBox(settings.topMarkWidth, settings.topMarkHeight).width * u / 2} y="0" width={scaledBox(settings.topMarkWidth, settings.topMarkHeight).width * u} height={scaledBox(settings.topMarkWidth, settings.topMarkHeight).height * u} fill={settings.topMarkFill} />}
                {player && side === 'back' && String(player.name || '').trim() && <FixedText value={player.name} cx={settings.nameX} cy={settings.nameY} width={scaledNameWidth} points={scaledNamePoints * (u / 72)} fontFamily={settings.nameFont} fill={settings.nameFill} stroke={settings.nameStroke} outlineWidth={settings.nameOutlineWidth} selected={activeControl === 'name'} onSelect={() => { setActiveControl('name'); setTextWasSelected(true); }} onMove={e => startDrag('name', e)} pageWidth={realWidth} pageHeight={realHeight} curve={settings.nameCurve} gradientEnabled={settings.nameGradientEnabled} gradientStart={settings.nameGradientStart} gradientEnd={settings.nameGradientEnd} gradientDirection={settings.nameGradientDirection} shadowEnabled={settings.nameShadowEnabled} shadowColor={settings.nameShadowColor} shadowBlur={settings.nameShadowBlur} shadowOffsetX={settings.nameShadowOffsetX} shadowOffsetY={settings.nameShadowOffsetY} />}
                {player && ((side === 'back') || (side === 'front' && settings.frontNumber)) && String(player.number || '').trim() && <FixedText value={player.number} cx={side === 'back' ? settings.numberX : settings.frontNumberX} cy={side === 'back' ? settings.numberY : settings.frontNumberY} width={side === 'back' ? scaledNumberWidth : scaleWidth(settings.frontNumberWidth || 4, realWidth)} points={(side === 'back' ? scaledNumberPoints : scalePoints(settings.frontNumberPoints || 300, realWidth)) * (u / 72)} fontFamily={settings.numberFont} fill={settings.numberFill} stroke={settings.numberStroke} outlineWidth={settings.numberOutlineWidth} selected={activeControl === (side === 'front' ? 'frontNumber' : 'number')} onSelect={() => { setActiveControl(side === 'front' ? 'frontNumber' : 'number'); setTextWasSelected(true); }} onMove={e => startDrag(side === 'front' ? 'frontNumber' : 'number', e)} pageWidth={realWidth} pageHeight={realHeight} curve={settings.numberCurve} gradientEnabled={settings.numberGradientEnabled} gradientStart={settings.numberGradientStart} gradientEnd={settings.numberGradientEnd} gradientDirection={settings.numberGradientDirection} shadowEnabled={settings.numberShadowEnabled} shadowColor={settings.numberShadowColor} shadowBlur={settings.numberShadowBlur} shadowOffsetX={settings.numberShadowOffsetX} shadowOffsetY={settings.numberShadowOffsetY} />}
                {side === 'back' && settings.sponsorEnabled && sponsorLayers.filter(line => line.enabled !== false && String(line.text || '').trim()).map(line => <FixedText key={line.id} value={line.text} cx={line.x ?? 50} cy={line.y ?? 12} width={scaleWidth(line.width ?? 12, realWidth)} points={scalePoints(line.points ?? 160, realWidth) * (u / 72)} fontFamily={line.font || settings.nameFont} fill={line.fill || '#ffffff'} stroke={line.stroke || '#111111'} outlineWidth={line.outlineWidth ?? 0} selected={activeControl === `sponsor:${line.id}`} onSelect={() => openSponsorEditor(line.id)} onMove={e => startDrag(`sponsor:${line.id}`, e)} pageWidth={realWidth} pageHeight={realHeight} curve={line.curve ?? 0} gradientEnabled={line.gradientEnabled} gradientStart={line.gradientStart} gradientEnd={line.gradientEnd} gradientDirection={line.gradientDirection || 'horizontal'} shadowEnabled={line.shadowEnabled} shadowColor={line.shadowColor || '#000000'} shadowBlur={line.shadowBlur || 0} shadowOffsetX={line.shadowOffsetX || 0} shadowOffsetY={line.shadowOffsetY || 0} />)}
                {side === 'back' && player?.sleeve === 'Full' && settings.sleeveMarkEnabled !== false && (() => {
                  const location = settings.sleeveMarkPosition || 'bottom-left';
                  // The master identifier is a 0.5 × 0.5 inch square at M (21 × 29).
                  // Dimensions scale with the selected jersey page, matching the main marks.
                  const baseInches = Math.max(0.1, Number(settings.sleeveMarkHeight ?? .5));
                  const markerWidth = baseInches * (realWidth / 21) * u;
                  const markerHeight = baseInches * (realHeight / 29) * u;
                  const edgePad = Math.max(2, .045*u);
                  const x = location.endsWith('left') ? edgePad+markerWidth/2 : location.endsWith('right') ? realWidth*u-edgePad-markerWidth/2 : realWidth*u/2;
                  const y = location.startsWith('top') ? edgePad+markerHeight/2 : realHeight*u-edgePad-markerHeight/2;
                  const color = settings.sleeveMarkFill || '#000000';
                  return <g pointerEvents="none"><text x={x} y={y} dominantBaseline="central" textAnchor="middle" textLength={markerWidth*.94} lengthAdjust="spacingAndGlyphs" fontFamily="Arial" fontWeight="900" fontSize={markerHeight*.54} stroke="#ffffff" strokeWidth={Math.max(.8,markerHeight*.08)} paintOrder="stroke" fill={color}>{settings.sleeveMarkText || 'FULL SLEEVE'}</text></g>;
                })()}
                {(side === 'back' || side === 'front') && settings.markPreset !== 'dual-edge' && settings.bottomMarkEnabled !== false && (() => {
                  const box = scaledBox(settings.bottomMarkWidth ?? .5, settings.bottomMarkHeight ?? .5);
                  const bw = box.width*u, bh = box.height*u;
                  const x = (realWidth*u-bw)/2, y = realHeight*u-bh;
                  return <g pointerEvents="none"><rect x={x} y={y} width={bw} height={bh} fill={settings.bottomMarkFill||'#000000'}/><text x={realWidth*u/2} y={y+bh/2} dominantBaseline="middle" textAnchor="middle" fontFamily="Arial" fontSize={bh*.55} fontWeight="900" fill={settings.bottomMarkTextFill||'#ffffff'}>{currentSize}</text></g>;
                })()}
                {settings.markPreset === 'dual-edge' && (side === 'back' || side === 'front') && settings.topMarkEnabled !== false && <rect x={(realWidth*u)/2 - scaledBox(settings.topMarkWidth,settings.topMarkHeight).width*u/2} y={realHeight*u - scaledBox(settings.topMarkWidth,settings.topMarkHeight).height*u} width={scaledBox(settings.topMarkWidth,settings.topMarkHeight).width*u} height={scaledBox(settings.topMarkWidth,settings.topMarkHeight).height*u} fill={settings.topMarkFill}/>}
                {settings.markPreset === 'dual-edge' && settings.markLabelEnabled !== false && (side === 'back' || side === 'front') && (() => {
                  const pos = settings.markLabelPosition || 'bottom-left';
                  const x = pos.includes('left') ? 3 : pos.includes('right') ? 97 : 50;
                  const y = pos.startsWith('top') ? 2 : pos.startsWith('bottom') ? 98 : 50;
                  return <text x={`${x}%`} y={`${y}%`} dominantBaseline="middle" textAnchor={pos.includes('left')?'start':pos.includes('right')?'end':'middle'} fontFamily="Arial" fontSize={Math.max(10,realWidth*u*.021)} fontWeight="900" paintOrder="stroke" stroke={settings.markLabelBackground||'#000000'} strokeWidth="5" fill={settings.markLabelColor||'#ffffff'}>{sizeLabel(currentSize).replace(/ \(.*\)$/,'')}-{player?.quantity || 1}</text>;
                })()}
              </svg>
                </div>
              </div>
            </div>
            <div className="preview-footer"><button onClick={() => setPlayerIndex(i => Math.max(0, i - 1))}>← Previous</button><div><strong>{player?.name || 'No player selected'}</strong><span>{player ? `#${player.number || '—'} · ${sizeLabel(currentSize)} · ${player.sleeve}` : 'Add a player or import a roster'}</span></div><button onClick={() => setPlayerIndex(i => Math.min(players.length - 1, i + 1))}>Next →</button></div>
            <p className="editor-note">M size (21 × 29) is the master. Name = 195 pt, max 12 inches. Number = 650 pt, max 12 inches. Other sizes scale dynamically. Height varies naturally by font family.</p>
          </section>
          <div className={`right-workspace ${rightToolsOpen ? 'right-workspace-open' : ''}`}>
          <aside className="properties panel" aria-label="Detailed editing controls"><div className="panel-heading"><h2>Properties</h2><span className="tiny-tag">LIVE</span></div><div className="tabbar property-tabs">{[['text', 'Text'], ['layout', 'Layout'], ['parts', 'Parts']].map(([key, label]) => <button key={key} className={settingsTab === key ? 'selected' : ''} onClick={() => setSettingsTab(key)}>{label}</button>)}</div>
            {settingsTab === 'text' ? <div className="property-content">
              <h3 id="js-fonts-section">Fonts</h3>
              <button className="subtle full" onClick={findLocalFonts}>⌕ Detect installed fonts</button>
              <p className="helper">{fontStatus}</p>
              <label className="subtle full font-upload">＋ Upload custom font<input hidden type="file" accept=".ttf,.otf,.woff,.woff2" onChange={e => { uploadFont(e.target.files?.[0]); e.target.value = ''; }} /></label>
              <div className="divider" />
              <h3 id="js-text-effects-section">Player name</h3>
              <label className="field">Name font{fontOption(settings.nameFont, v => set('nameFont', v))}</label>
              {textEffectControls('name', { ...nameConfig, font: settings.nameFont }, patch => setSettings(s => ({ ...s, nameFont: patch.font ?? s.nameFont, namePoints: patch.points ?? s.namePoints, nameWidth: patch.width ?? s.nameWidth, nameFill: patch.fill ?? s.nameFill, nameStroke: patch.stroke ?? s.nameStroke, nameOutlineWidth: patch.outlineWidth ?? s.nameOutlineWidth, nameCurve: patch.curve ?? s.nameCurve, nameGradientEnabled: patch.gradientEnabled ?? s.nameGradientEnabled, nameGradientStart: patch.gradientStart ?? s.nameGradientStart, nameGradientEnd: patch.gradientEnd ?? s.nameGradientEnd, nameGradientDirection: patch.gradientDirection ?? s.nameGradientDirection, nameShadowEnabled: patch.shadowEnabled ?? s.nameShadowEnabled, nameShadowColor: patch.shadowColor ?? s.nameShadowColor, nameShadowBlur: patch.shadowBlur ?? s.nameShadowBlur, nameShadowOffsetX: patch.shadowOffsetX ?? s.nameShadowOffsetX, nameShadowOffsetY: patch.shadowOffsetY ?? s.nameShadowOffsetY })), null, resetNameSettings)}
              <div className="divider" />
              <h3>Player number</h3>
              <label className="field">Number font{fontOption(settings.numberFont, v => set('numberFont', v))}</label>
              {textEffectControls('number', { ...numberConfig, font: settings.numberFont }, patch => setSettings(s => ({ ...s, numberFont: patch.font ?? s.numberFont, numberPoints: patch.points ?? s.numberPoints, numberWidth: patch.width ?? s.numberWidth, numberFill: patch.fill ?? s.numberFill, numberStroke: patch.stroke ?? s.numberStroke, numberOutlineWidth: patch.outlineWidth ?? s.numberOutlineWidth, numberCurve: patch.curve ?? s.numberCurve, numberGradientEnabled: patch.gradientEnabled ?? s.numberGradientEnabled, numberGradientStart: patch.gradientStart ?? s.numberGradientStart, numberGradientEnd: patch.gradientEnd ?? s.numberGradientEnd, numberGradientDirection: patch.gradientDirection ?? s.numberGradientDirection, numberShadowEnabled: patch.shadowEnabled ?? s.numberShadowEnabled, numberShadowColor: patch.shadowColor ?? s.numberShadowColor, numberShadowBlur: patch.shadowBlur ?? s.numberShadowBlur, numberShadowOffsetX: patch.shadowOffsetX ?? s.numberShadowOffsetX, numberShadowOffsetY: patch.shadowOffsetY ?? s.numberShadowOffsetY })), null, resetNumberSettings)}
              <p className="inline-note">Name and number now use fixed master rules at M size, then scale automatically for other jersey sizes.</p>
              <div className="divider" />
              <h3 id="js-sponsor-section">Sponsor text layers</h3>
              <label className="check"><input type="checkbox" checked={settings.sponsorEnabled} onChange={e => set('sponsorEnabled', e.target.checked)} />Enable sponsor text layers</label>
              <button className="subtle full" onClick={addSponsor}>＋ Add sponsor line</button>
              <div className="sponsor-list">{sponsorLayers.map(line => <div key={line.id} className={`sponsor-item ${activeControl === `sponsor:${line.id}` ? 'active' : ''}`}><div className="sponsor-head"><strong>{line.label || `Sponsor ${line.id}`}</strong><div className="sponsor-actions"><button type="button" onClick={() => openSponsorEditor(line.id,true)}>Select &amp; edit</button><button type="button" onClick={() => removeSponsor(line.id)}>Delete</button></div></div><label className="check"><input type="checkbox" checked={line.enabled !== false} onChange={e => updateSponsor(line.id, { enabled: e.target.checked })} />Enabled</label><label className="field"><span>Label</span><input value={line.label || ''} onChange={e => updateSponsor(line.id, { label: e.target.value })} /></label><label className="field textarea-field"><span>Text</span><textarea id={`js-sponsor-text-${line.id}`} value={line.text || ''} onChange={e => updateSponsor(line.id, { text: e.target.value })} /></label><label className="field">Font{fontOption(line.font || settings.nameFont, v => updateSponsor(line.id, { font: v }))}</label>{textEffectControls('sponsor', { points: line.points ?? 160, width: line.width ?? 12, fill: line.fill ?? '#ffffff', stroke: line.stroke ?? '#111111', outlineWidth: line.outlineWidth ?? 0, curve: line.curve ?? 0, gradientEnabled: line.gradientEnabled ?? false, gradientStart: line.gradientStart ?? '#ffffff', gradientEnd: line.gradientEnd ?? '#ffffff', gradientDirection: line.gradientDirection ?? 'horizontal', shadowEnabled: line.shadowEnabled ?? false, shadowColor: line.shadowColor ?? '#000000', shadowBlur: line.shadowBlur ?? 0, shadowOffsetX: line.shadowOffsetX ?? 0, shadowOffsetY: line.shadowOffsetY ?? 0 }, patch => updateSponsor(line.id, patch))}</div>)}</div>
            </div> : settingsTab === 'layout' ? <div className="property-content"><h3>Size chart profiles</h3><label className="field">Active chart<select value={activeChart} onChange={e => setActiveChart(e.target.value)}>{Object.keys(chartNames).map(n => <option key={n} value={n}>{n}</option>)}</select></label><div className="profile-actions"><button className="subtle" onClick={createChart}>＋ Create chart</button>{activeChart !== 'Standard' && <button className="subtle danger" onClick={deleteChart}>Delete chart</button>}</div><p className="helper">Standard is your official locked size chart. Create unlimited named copies to customize inches.</p><h3>Page preset</h3><label className="field">Size<select value={settings.editSize} onChange={e => set('editSize', e.target.value)}>{sizes.map(s => <option key={s} value={s}>{sizeLabel(s)}</option>)}</select></label><div className="two-cols"><Field label="Width (in)" disabled={activeChart === 'Standard'} value={settings.sizes[settings.editSize].width} step={.25} onChange={v => updateDimension('width', v)} /><Field label="Height (in)" disabled={activeChart === 'Standard'} value={settings.sizes[settings.editSize].height} step={.25} onChange={v => updateDimension('height', v)} /></div><button className="subtle full" disabled={activeChart === 'Standard'} onClick={addSize}>＋ Add size preset</button><p className="helper">Official size chart loaded automatically. {sizeLabel(currentSize)} uses {dimensions.width} × {dimensions.height} inches. The standard chart includes 6 months = 12 × 18 inches.</p><div className="divider" /><h3>Positioning</h3><label className="check"><input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} />Move name & number together</label><label className="field">Selected element<select value={activeControl} onChange={e => setActiveControl(e.target.value)}><option value="name">Name</option><option value="number">Back number</option><option value="frontNumber">Front number</option>{sponsorOptions.map(item => <option key={item.id} value={`sponsor:${item.id}`}>{item.label}</option>)}</select></label>{positionBar('Name horizontal', settings.nameX, v => set('nameX', v))}{positionBar('Name vertical', settings.nameY, v => set('nameY', v))}{positionBar('Number horizontal', settings.numberX, v => set('numberX', v))}{positionBar('Number vertical', settings.numberY, v => set('numberY', v))}{positionBar('Front no. horizontal', settings.frontNumberX, v => set('frontNumberX', v))}{positionBar('Front no. vertical', settings.frontNumberY, v => set('frontNumberY', v))}{activeSponsor && <><div className="divider" /><h3>Selected sponsor position</h3>{positionBar('Sponsor horizontal', activeSponsor.x ?? 50, v => updateSponsor(activeSponsor.id, { x: v }))}{positionBar('Sponsor vertical', activeSponsor.y ?? 12, v => updateSponsor(activeSponsor.id, { y: v }))}</>}<div className="nudge"><button onClick={() => adjustPosition('x', -1)}>←</button><button onClick={() => adjustPosition('y', -1)}>↑</button><button onClick={() => adjustPosition('y', 1)}>↓</button><button onClick={() => adjustPosition('x', 1)}>→</button></div><button className="subtle full" onClick={resetPosition}>Reset positions</button><p className="helper">Drag the text directly on the canvas, or use sliders and arrows. Sponsor lines are individually movable.</p></div> : <div className="property-content"><h3>Alignment &amp; mark presets</h3>
              <label className="check"><input type="checkbox" checked={settings.smartGuidesEnabled !== false} onChange={e => set('smartGuidesEnabled',e.target.checked)}/>Smart alignment / snap guides</label>
              <ColorField label="Guide line color" value={settings.smartGuideColor||'#00f0ff'} onChange={v => set('smartGuideColor',v)} />
              <label className="field">Marking preset<select value={settings.markPreset || 'standard'} onChange={e=>set('markPreset',e.target.value)}><option value="standard">Standard (top 0.1 × 0.3, bottom 0.5 × 0.5)</option><option value="dual-edge">Dual-edge registration (front &amp; back)</option></select></label>
              {settings.markPreset === 'dual-edge' && <>
                <p className="helper">Same small top-center rectangle at top and bottom on Front and Back. Does not alter the size chart.</p>
                <label className="check"><input type="checkbox" checked={settings.markLabelEnabled!==false} onChange={e=>set('markLabelEnabled',e.target.checked)}/>Print size–quantity identifier</label>
                <label className="field">Identifier position<select value={settings.markLabelPosition||'bottom-left'} onChange={e=>set('markLabelPosition',e.target.value)}>{[['top-left','Top left'],['top-center','Top center'],['top-right','Top right'],['middle-left','Middle left'],['center','Center'],['middle-right','Middle right'],['bottom-left','Bottom left'],['bottom-center','Bottom center'],['bottom-right','Bottom right']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
                <ColorField label="Identifier text color" value={settings.markLabelColor||'#ffffff'} onChange={v=>set('markLabelColor',v)}/>
                <ColorField label="Identifier outline color" value={settings.markLabelBackground||'#000000'} onChange={v=>set('markLabelBackground',v)}/>
              </>}
              <div className="divider"/><h3>Registration marks</h3><label className="check"><input type="checkbox" checked={settings.bottomMarkEnabled} onChange={e => set('bottomMarkEnabled', e.target.checked)} />Bottom centered size square (touching edge)</label><div className="two-cols"><Field label="Bottom width (in)" value={settings.bottomMarkWidth} step={.05} onChange={v => set('bottomMarkWidth', v)} /><Field label="Bottom height (in)" value={settings.bottomMarkHeight} step={.05} onChange={v => set('bottomMarkHeight', v)} /></div><ColorField label="Bottom box color" value={settings.bottomMarkFill} onChange={v => set('bottomMarkFill', v)} /><ColorField label="Size text color" value={settings.bottomMarkTextFill} onChange={v => set('bottomMarkTextFill', v)} /><label className="check"><input type="checkbox" checked={settings.topMarkEnabled} onChange={e => set('topMarkEnabled', e.target.checked)} />Top centered rectangle (touching edge)</label><div className="two-cols"><Field label="Top width (in)" value={settings.topMarkWidth} step={.05} onChange={v => set('topMarkWidth', v)} /><Field label="Top height (in)" value={settings.topMarkHeight} step={.05} onChange={v => set('topMarkHeight', v)} /></div><ColorField label="Top mark color" value={settings.topMarkFill} onChange={v => set('topMarkFill', v)} /><div className="divider"/><h3>Back print identifier — Full Sleeve orders only</h3><label className="check"><input type="checkbox" checked={settings.sleeveMarkEnabled} onChange={e => set('sleeveMarkEnabled', e.target.checked)} />Mark the BACK print when player sleeve type is Full</label><label className="field">Identifier text (default: FULL SLEEVE)<input type="text" value={settings.sleeveMarkText} onChange={e => set('sleeveMarkText', e.target.value)} /></label><label className="field">Position<select value={settings.sleeveMarkPosition} onChange={e => set('sleeveMarkPosition', e.target.value)}><option value="bottom-left">Bottom left (edge)</option><option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option><option value="top-left">Top left</option><option value="top-right">Top right</option></select></label><Field label="Identifier square (in at M)" step={.05} value={settings.sleeveMarkHeight} onChange={v => set('sleeveMarkHeight', v)} /><ColorField label="Back identifier color" value={settings.sleeveMarkFill} onChange={v => set('sleeveMarkFill', v)} /><div className="divider" /><h3>Front number</h3><label className="check"><input type="checkbox" checked={settings.frontNumber} onChange={e => set('frontNumber', e.target.checked)} />Enable front number</label><div className="two-cols"><Field label="Front width (in)" value={settings.frontNumberWidth} step={.25} onChange={v => set('frontNumberWidth', v)} /><Field label="Front font size (pt)" value={settings.frontNumberPoints} step={1} onChange={v => set('frontNumberPoints', v)} /></div><p className="helper">Front number is now movable on the front preview only. It no longer appears on sleeves or collar.</p><div className="divider" /><h3>Sleeve size chart</h3>
<label className="field">Active sleeve chart<select value={activeSleeveProfile} onChange={e=>setActiveSleeveProfile(e.target.value)}>{Object.keys(sleeveProfiles).map(name=><option key={name} value={name}>{name}</option>)}</select></label>
<div className="profile-actions"><button className="subtle" onClick={createSleeveProfile}>＋ Add chart</button>{activeSleeveProfile!=='Standard'&&<button className="subtle danger" onClick={deleteSleeveProfile}>Delete chart</button>}</div>
<p className="helper">Standard follows your reference and cannot be edited. A custom chart starts as a copy and can be changed. The half-sleeve size 20 measurement was not supplied, so Standard provisionally uses the 22–28 dimensions.</p>
{['Half','Full'].map(type=><div key={type} className="sleeve-chart-table"><h3>{type} sleeve (inches)</h3>{Object.keys(settings.sizes).map(code=>{const dims=getSleeveDimensions(code,type,sleeveChart);return <div className="sleeve-chart-row" key={`${type}-${code}`}><span>{sizeLabel(code)}</span><input aria-label={`${type} ${code} width`} type="number" min="0.1" step="0.25" disabled={activeSleeveProfile==='Standard'} value={dims.width} onChange={e=>updateSleeveChart(type,code,'width',Number(e.target.value))}/><span>×</span><input aria-label={`${type} ${code} height`} type="number" min="0.1" step="0.25" disabled={activeSleeveProfile==='Standard'} value={dims.height} onChange={e=>updateSleeveChart(type,code,'height',Number(e.target.value))}/></div>})}</div>)}
<div className="divider" /><h3>Collar</h3><label className="field">Preset<select value={settings.collarType} onChange={e => { const type = e.target.value; setSettings(s => ({ ...s, collarType: type, collarWidth: 18, collarHeight: type === 'shirt' ? 7 : 4 })); }}><option value="ready">Ready-made</option><option value="shirt">Shirt</option><option value="chinese">Chinese</option></select></label><div className="two-cols"><Field label="Width (in)" value={settings.collarWidth} onChange={v => set('collarWidth', v)} /><Field label="Height (in)" value={settings.collarHeight} onChange={v => set('collarHeight', v)} /></div><p className="helper">During export, one uploaded sleeve side is mirrored to generate the opposite. If both sides exist, both originals are kept.</p></div>}
            <div className="export-panel">{invalidPlayers.length > 0 && <p className="import-status">⚠ Unknown jersey sizes: {invalidPlayers.map(p => `${p.name || 'Unnamed'} (${p.size})`).join(', ')}. Correct them in Players before export.</p>}
              <h3>Print PNG Export</h3>
              <label className="field">Resolution
                <select value={exportDpi} onChange={e => setExportDpi(Number(e.target.value))} disabled={exportBusy}>
                  <option value={300}>300 DPI · production (high memory)</option>
                  <option value={150}>150 DPI · test export</option>
                </select>
              </label>
              <p className="export-summary">{exportJobs.error ? exportJobs.error : `${exportJobs.jobs.length} unique PNG files · ${counts} total jerseys`}</p>
              {exportProgress && <div className="export-progress"><div className="export-progress-track"><div style={{ width: `${exportProgress.total ? Math.round(100 * exportProgress.done / exportProgress.total) : 0}%` }} /></div><small>{exportProgress.label}</small></div>}
              <button className="action" disabled={exportBusy || Boolean(exportJobs.error)} onClick={()=>setExportReviewOpen(true)}>{exportBusy ? 'Generating files…' : '→ Review & Export'}</button>
              <p>Front without numbers: SIZE-QUANTITY.png. Front with numbers: NUMBER-QUANTITY.png. Back files remain in BACK NAME/. Blank name and blank number are both allowed now. Verify physical sizes before printing.</p>
            </div>
          </aside>
          <nav className="design-tool-rail" aria-label="Design tools">
            {[
              ['text','T','Text'],
              ['fonts','Aa','Fonts'],
              ['effects','✧','Effects'],
              ['layers','▤','Layers'],
              ['layout','▦','Layout'],
              ['parts','◈','Parts'],
              ['export','↗','Export'],
            ].map(([id,mark,label]) => <button key={id} type="button" className={`design-rail-button ${rightToolsOpen && rightTool === id ? 'active' : ''}`} aria-label={`Open ${label}`} aria-expanded={id === 'export' ? undefined : rightToolsOpen && rightTool === id} title={label} onClick={() => openRightTool(id)}><span>{mark}</span><small>{label}</small></button>)}
            <button type="button" className="design-rail-close" onClick={()=>setRightToolsOpen(false)} title="Close editing panel" aria-label="Close editing panel">×</button>
          </nav>
          </div>
        </div></>}
    </section>
  </div>;
}

export default App;
