import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import * as XLSX from 'xlsx';
import { recognize } from 'tesseract.js';
import { createProductionJobs, exportProductionZip } from './exportEngine';
import { DEFAULT_SIZES, canonicalSize, migrateSizePresets, sizeLabel } from './sizeChart';
import { loadArtwork } from './artworkImport';
import VectorWorkspace from './VectorWorkspace';

const initialSizes = DEFAULT_SIZES;
const DEFAULT_CHARTS = {Standard:DEFAULT_SIZES};
const upper = v => String(v??'').toLocaleUpperCase();
const initialSettings = {
  sizes:initialSizes, editSize:'38', nameFont:'Arial', numberFont:'Impact',
  namePoints:195, numberPoints:625, nameWidth:12, nameHeight:1.65, numberWidth:8, numberHeight:6, sponsorText:'', sponsorEnabled:false, sponsorX:50, sponsorY:12, sponsorWidth:14, sponsorHeight:1.1, sponsorFill:'#ff0000',
  nameFill:'#ffffff',nameStroke:'#111111', numberFill:'#ffffff',numberStroke:'#111111',
  stroke:2, nameX:50,nameY:24,numberX:50,numberY:51,space:10,
  topMarkEnabled:true,topMarkWidth:0.1,topMarkHeight:0.3,topMarkFill:'#ff0000',
  bottomMarkEnabled:true,bottomMarkWidth:0.5,bottomMarkHeight:0.5,bottomMarkFill:'#000000',bottomMarkTextFill:'#ffffff',
  sleeveMarkEnabled:true,sleeveMarkText:'FULL SLEEVE',sleeveMarkPosition:'bottom-left',sleeveMarkFill:'#000000',sleeveMarkHeight:0.2,
  frontNumber:false,frontPosition:'center',halfWidth:18,halfHeight:11,
  fullWidth:18,fullHeight:26,collarType:'ready',collarWidth:18,collarHeight:4,
};
const defaultPlayers=[{id:1,name:'RAHUL',number:'07',size:'38',quantity:1,sleeve:'Half'},{id:2,name:'AMAN',number:'10',size:'40',quantity:2,sleeve:'Full'}];
const uploadTypes=[['front','Front'],['back','Back'],['leftSleeve','Left sleeve'],['rightSleeve','Right sleeve'],['halfSleeve','Half sleeve'],['fullSleeve','Full sleeve'],['collar','Collar']];
const basicFonts=['Arial','Arial Black','Impact','Georgia','Verdana','Tahoma','Trebuchet MS','Times New Roman','Courier New','Comic Sans MS','Segoe UI'];
function fromStorage(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch{return fallback;}}
function Field({label,value,onChange,type='number',step=1,min=0}){return <label className="field"><span>{label}</span><input type={type} step={step} min={min} value={value} onChange={e=>onChange(type==='number'?Number(e.target.value):e.target.value)}/></label>;}
function ColorField({label,value,onChange}){return <label className="color-field"><span>{label}</span><input type="color" value={value} onChange={e=>onChange(e.target.value)}/></label>;}

function cleanCell(value) { return String(value ?? '').trim(); }
function normalizeHeader(value) { return cleanCell(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }
const columns = {
  name: ['name','playername','playersname','fullname','player'],
  number: ['number','no','jerseyno','jerseynumber','playernumber','num'],
  size: ['size','shirtsize','jerseysize','tshirtsize'],
  quantity: ['quantity','qty','count','pieces','pcs'],
  sleeve: ['sleeve','sleeves','sleevetype'],
};
function parseRows(rows, defaultSize='38') {
  const filtered = rows.map(r => (Array.isArray(r) ? r : [])).filter(r => r.some(c => cleanCell(c)));
  if (!filtered.length) return [];
  const first = filtered[0].map(normalizeHeader);
  const matched = Object.fromEntries(Object.entries(columns).map(([key, aliases]) => [key,first.findIndex(h => aliases.includes(h))]));
  const headerExists = Object.values(matched).filter(x=>x>=0).length >= 2;
  const source = headerExists ? filtered.slice(1) : filtered;
  return source.map((cells,index) => {
    const at = (key,fallbackIndex) => cleanCell(cells[headerExists ? matched[key] : fallbackIndex]);
    const name = at('name',0);
    const number = at('number',1);
    const rawSize = at('size',2) || defaultSize;
    const size = canonicalSize(rawSize) || rawSize;
    const q = parseInt(at('quantity',3),10);
    const sleeveText = at('sleeve',4).toLowerCase();
    return { id: Date.now()+index+Math.round(Math.random()*100000),name:upper(name),number,size,quantity:Number.isFinite(q)&&q>0?q:1,sleeve:sleeveText.includes('full')?'Full':'Half' };
  }).filter(r=>r.name||r.number);
}
function parseTyped(text,defaultSize='38') {
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  // Supports CSV, tab-delimited, and lines like "RAHUL 07 38 2 Full".
  const rows=lines.map(line=>{
    if(line.includes('\t'))return line.split('\t');
    if(line.includes(',')||line.includes(';'))return line.split(/[;,]/);
    const parts=line.match(/^(.*?)\s+(\d{1,4})\s+(\d{2}|[A-Za-z0-9]{1,6})\s*(\d+)?\s*(full|half)?$/i);
    return parts ? [parts[1],parts[2],parts[3],parts[4]||'1',parts[5]||'Half'] : [line];
  });
  return parseRows(rows,defaultSize);
}
// Exact fixed-box scaling: any length of text fills the same inch-sized rectangle.
// SVG uses 100 drawing units per physical inch. This is an interactive layout
// preview; a true DPI/ICC print renderer will be added in the export phase.
function FixedText({ value, cx, cy, width, height, fontFamily, fill, stroke, strokeWidth, selected, onSelect, onMove, pageWidth, pageHeight, pxPerIn=100 }) {
  const measureRef = useRef(null);
  const [bounds, setBounds] = useState({ width: 100, height: 80, x: -50, y: -60 });
  useEffect(() => {
    if (!measureRef.current) return;
    try {
      const b = measureRef.current.getBBox();
      if (b.width > 0 && b.height > 0) setBounds({ width: b.width, height: b.height, x: b.x, y: b.y });
    } catch { /* unavailable until SVG attaches */ }
  }, [value, fontFamily]);
  const boxW = Math.max(0.1, width) * pxPerIn;
  const boxH = Math.max(0.1, height) * pxPerIn;
  const xx = (cx / 100) * pageWidth * pxPerIn;
  const yy = (cy / 100) * pageHeight * pxPerIn;
  const sx = boxW / bounds.width;
  const sy = boxH / bounds.height;
  const offsetX = -(bounds.x + bounds.width / 2);
  const offsetY = -(bounds.y + bounds.height / 2);
  return <g onPointerDown={e=>{e.stopPropagation();onSelect?.();onMove?.(e);}} style={{cursor:'move'}}>
    <text ref={measureRef} x={0} y={0} fontSize={100} fontWeight={900} fontFamily={fontFamily} visibility="hidden" pointerEvents="none">{value || ' '}</text>
    <g transform={`translate(${xx} ${yy}) scale(${sx} ${sy}) translate(${offsetX} ${offsetY})`}>
      <text x={0} y={0} fontSize={100} fontWeight={900} fontFamily={fontFamily} fill={fill} stroke={stroke} strokeWidth={strokeWidth} paintOrder="stroke">{value || ' '}</text>
    </g>
    {selected && <rect x={xx-boxW/2} y={yy-boxH/2} width={boxW} height={boxH} fill="none" stroke="#4b4b4b" strokeWidth={Math.max(2,pxPerIn*.025)} strokeDasharray="12 8" pointerEvents="none"/>}
  </g>;
}

function App(){
  const [workspace,setWorkspace]=useState('sizing');
  const [sidebarOpen,setSidebarOpen]=useState(true);
  const [drawer,setDrawer]=useState('artwork');
  const [importText,setImportText]=useState('');
  const [importResults,setImportResults]=useState([]);
  const [importStatus,setImportStatus]=useState('');
  const [importBusy,setImportBusy]=useState(false);
  const [importFileName,setImportFileName]=useState('');
  const [settings,setSettings]=useState(()=>{const saved=fromStorage('js-settings',{});return {...initialSettings,...saved,editSize:canonicalSize(saved.editSize||'38',saved.sizes)||'38',sizes:migrateSizePresets(saved.sizes)};});
  const [chartNames,setChartNames]=useState(()=>{const old=fromStorage('js-size-charts',null);if(old&&typeof old==='object')return {...old,Standard:DEFAULT_SIZES};const previous=fromStorage('js-settings',{}).sizes;const customized=previous&&Object.entries(previous).some(([key,d])=>DEFAULT_SIZES[key]&&(Number(d.width)!==DEFAULT_SIZES[key].width||Number(d.height)!==DEFAULT_SIZES[key].height));return customized?{Standard:DEFAULT_SIZES,'Previous Custom':migrateSizePresets(previous)}:{Standard:DEFAULT_SIZES};});
  const [activeChart,setActiveChart]=useState(()=>fromStorage('js-active-chart','Standard'));
  useEffect(()=>{const selected=chartNames[activeChart] || DEFAULT_SIZES; setSettings(old=>({...old,sizes: structuredClone(selected)}));},[activeChart]);
  useEffect(()=>localStorage.setItem('js-size-charts',JSON.stringify(chartNames)),[chartNames]);
  useEffect(()=>localStorage.setItem('js-active-chart',JSON.stringify(activeChart)),[activeChart]);
  const chartWasLoaded=useRef(false);
  useEffect(()=>{if(!chartWasLoaded.current){chartWasLoaded.current=true;return;} if(activeChart==='Standard')return;setChartNames(c=>({...c,[activeChart]:structuredClone(settings.sizes)}));},[settings.sizes,activeChart]);
  const [players,setPlayers]=useState(()=>fromStorage('js-players',defaultPlayers).map(p=>({...p,name:upper(p.name),size:canonicalSize(p.size)||p.size})));
  const [art,setArt]=useState({});
  const [reference,setReference]=useState(null);
  const [fonts,setFonts]=useState(basicFonts);
  const [fontStatus,setFontStatus]=useState('Installed font discovery requires permission in Chrome/Edge on localhost or HTTPS.');
  const [playerIndex,setPlayerIndex]=useState(0);
  const [side,setSide]=useState('back');
  const [markTab,setMarkTab]=useState(false);
  const [grouped,setGrouped]=useState(false);
  const [activeControl,setActiveControl]=useState('name');
  const [notice,setNotice]=useState('');
  const [exportDpi,setExportDpi]=useState(300);
  const [exportBusy,setExportBusy]=useState(false);
  const [exportProgress,setExportProgress]=useState(null);
  const [settingsTab,setSettingsTab]=useState('text');
  const svgRef=useRef(null);
  const dragRef=useRef(null);
  const fontFiles=useRef([]);
  useEffect(()=>{localStorage.setItem('js-settings',JSON.stringify(settings));},[settings]);
  useEffect(()=>{localStorage.setItem('js-players',JSON.stringify(players));},[players]);
  useEffect(()=>()=>{fontFiles.current.forEach(url=>URL.revokeObjectURL(url));},[]);
  const set=(key,value)=>setSettings(s=>({...s,[key]:value}));
  const sizes=Object.keys(settings.sizes);
  const player=players[Math.min(playerIndex,players.length-1)]||null;
  const currentSize=canonicalSize(player?.size||settings.editSize,settings.sizes)||player?.size||settings.editSize;
  const dimensions=settings.sizes[currentSize]||{width:21,height:29};
  const invalidPlayers=players.filter(p=>!canonicalSize(p.size,settings.sizes));
  const counts=useMemo(()=>players.reduce((v,p)=>v+(Number(p.quantity)||0),0),[players]);
  const image=art[side];
  async function readImage(file,cb){if(!file)return;try{const result=await loadArtwork(file);cb(result);setNotice(`${file.name} loaded (first page for PDF/TIFF).`);}catch(e){setNotice(`Artwork import error: ${e.message}`);}}
  async function findLocalFonts(){
    if(!('queryLocalFonts' in window)){setFontStatus('This browser does not support local font enumeration. Use Chrome/Edge on localhost or upload a font.');return;}
    try{const result=await window.queryLocalFonts();const names=[...new Set(result.map(f=>f.family).filter(Boolean))].sort((a,b)=>a.localeCompare(b));setFonts(prev=>[...new Set([...prev,...names])]);setFontStatus(`Found ${names.length} installed font families. Select a font below.`);}
    catch(e){setFontStatus('Font access was denied or unavailable. Allow the browser permission or upload font files.');}
  }
  async function uploadFont(file){if(!file)return;if(!/\.(ttf|otf|woff2?)$/i.test(file.name)){setNotice('Upload a TTF, OTF, WOFF or WOFF2 font.');return;}const url=URL.createObjectURL(file);try{const family=file.name.replace(/\.[^.]+$/,'');const face=new FontFace(family,`url("${url}")`);await face.load();document.fonts.add(face);fontFiles.current.push(url);setFonts(a=>[...new Set([...a,family])]);set('nameFont',family);setFontStatus(`Loaded custom font: ${family}. Reupload after refreshing.`);}catch{URL.revokeObjectURL(url);setNotice('Could not load font file.');}}
  const changePlayer=(id,key,value)=>setPlayers(ps=>ps.map(p=>p.id===id?{...p,[key]:key==='size'?(canonicalSize(value,settings.sizes)||value):key==='name'?upper(value):value}:p));
  const addPlayer=()=>{setPlayers(ps=>[...ps,{id:Date.now(),name:'',number:'',size:'38',quantity:1,sleeve:'Half'}]);setPlayerIndex(players.length);};
  const removePlayer=id=>{setPlayers(ps=>ps.filter(p=>p.id!==id));setPlayerIndex(0);};
  function applyImport(mode) {
    if (!importResults.length) {setNotice('No extracted players to import.');return;}
    const normalized=importResults.map(p=>({...p,name:upper(p.name),size:canonicalSize(p.size,settings.sizes)||p.size}));
    setPlayers(current => mode==='replace' ? normalized : [...current,...normalized]);
    setPlayerIndex(0);
    setDrawer('players');
    setNotice(`${importResults.length} player records ${mode==='replace'?'replaced the list':'added to the list'}. Review before print export.`);
    setImportResults([]);
  }
  function parsePastedText() {
    const records=parseTyped(importText,settings.editSize);
    setImportResults(records.map(p=>({...p,name:upper(p.name),size:canonicalSize(p.size,settings.sizes)||p.size})));
    setImportStatus(records.length ? `${records.length} rows parsed. Review them below before importing.` : 'No recognizable player records found. Try CSV columns: Name,Number,Size,Quantity,Sleeve');
  }
  async function importRosterFile(file) {
    if(!file)return;
    setImportBusy(true);
    setImportStatus(`Reading ${file.name}...`);
    setImportFileName(file.name);
    try {
      const ext=file.name.split('.').pop().toLowerCase();
      let records=[];
      if(['xlsx','xls','csv'].includes(ext)) {
        const content=await file.arrayBuffer();
        const workbook=XLSX.read(content,{type:'array',raw:true});
        if(!workbook.SheetNames.length)throw new Error('No worksheet found.');
        const sheet=workbook.Sheets[workbook.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false});
        records=parseRows(rows,settings.editSize);
      } else if(['txt','tsv'].includes(ext)) {
        records=parseTyped(await file.text(),settings.editSize);
      } else if(file.type.startsWith('image/')||['png','jpg','jpeg','webp','bmp'].includes(ext)) {
        setImportStatus('Scanning image with OCR. Handwriting may require corrections.');
        const result=await recognize(file,'eng');
        const scanned=result.data.text||'';
        setImportText(scanned);
        records=parseTyped(scanned,settings.editSize);
      } else {
        throw new Error('Supported formats: .xlsx, .xls, .csv, .txt, .tsv, JPG, PNG, WebP, BMP. PDF import will be added later.');
      }
      setImportResults(records.map(p=>({...p,name:upper(p.name),size:canonicalSize(p.size,settings.sizes)||p.size})));
      setImportStatus(records.length?`${records.length} records extracted from ${file.name}. Verify names, leading zeros, sizes and quantities.`:'No records detected. Try a sheet with columns Name, Number, Size, Quantity, Sleeve.');
    } catch(error) {
      setImportResults([]);
      setImportStatus(`Import error: ${error.message}`);
    } finally {setImportBusy(false);}
  }
  const exportJobs = useMemo(() => {
    try { return {jobs:createProductionJobs(players,settings,art),error:''}; }
    catch(error){ return {jobs:[],error:error.message}; }
  },[players,settings,art]);
  async function downloadProductionZip() {
    if (exportBusy) return;
    setExportBusy(true);
    setExportProgress({done:0,total:exportJobs.jobs.length,label:'Starting PNG production…'});
    try {
      const result = await exportProductionZip({players,settings,artwork:art,dpi:exportDpi,onProgress:setExportProgress});
      setNotice(`ZIP ready: ${result.files} unique PNG files. Front PNGs are in the ZIP root; backs are in BACK NAME. Check print dimensions before mass production.`);
    } catch(error) {
      setNotice(`Export failed: ${error.message}`);
    } finally {
      setExportBusy(false);
    }
  }
  function csvDownload(){const rows=[['Name','Number','Size','Quantity','Sleeve'],...players.map(p=>[p.name,p.number,p.size,p.quantity,p.sleeve])];const csv=rows.map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='jersey-players.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function updateDimension(key,value){if(activeChart==='Standard'){setNotice('Standard chart is fixed. Create a named chart to edit dimensions.');return;}setSettings(s=>({...s,sizes:{...s.sizes,[s.editSize]:{...s.sizes[s.editSize],[key]:value}}}));}
  function addSize(){if(activeChart==='Standard'){setNotice('Create a named chart before adding a custom size.');return;}const answer=window.prompt('New size label (e.g. 52 or CUSTOM)');if(!answer?.trim())return;const key=canonicalSize(answer,settings.sizes)||answer.trim();setSettings(s=>({...s,editSize:key,sizes:{...s.sizes,[key]:s.sizes[key]||{width:21,height:29}}}));}
  function createChart(){const raw=window.prompt('Name your new size chart (for example ZS Digital)');const name=raw?.trim();if(!name)return;if(Object.keys(chartNames).some(n=>n.toLowerCase()===name.toLowerCase())){setNotice('That chart name already exists.');return;}const copy=structuredClone(settings.sizes);setChartNames(c=>({...c,[name]:copy}));setActiveChart(name);setNotice(`Created size chart: ${name}`);}
  function deleteChart(){if(activeChart==='Standard')return;if(!window.confirm(`Delete size chart ${activeChart}?`))return;setChartNames(c=>{const next={...c};delete next[activeChart];return next;});setActiveChart('Standard');}
  const clearPlayers=()=>{if(window.confirm(`Remove all ${players.length} players?`)){setPlayers([]);setPlayerIndex(0);}};
  const previewSleeveSource=(which)=>art[which==='left'?'leftSleeve':'rightSleeve']||art[side==='halfSleeve'?'halfSleeve':'fullSleeve']||art[which==='left'?'rightSleeve':'leftSleeve'];
  const mirrorPreviewSleeve=which=>!art[which==='left'?'leftSleeve':'rightSleeve']&&Boolean(art[which==='left'?'rightSleeve':'leftSleeve']||art[side]);
  function resetPosition(){setSettings(s=>({...s,nameX:50,nameY:24,numberX:50,numberY:51}));}
  function adjustPosition(axis,value){const keys=grouped?axis==='x'?['nameX','numberX']:['nameY','numberY']:[`${activeControl}${axis.toUpperCase()}`];setSettings(s=>{const copy={...s};keys.forEach(k=>copy[k]=Math.max(0,Math.min(100,copy[k]+value)));return copy;});}
  const fitNameWidth=Math.max(10,Math.min(98,100*settings.nameWidth/Math.max(1,dimensions.width)));
  const realWidth=Math.max(.1,Number(dimensions.width)||21);
  const realHeight=Math.max(.1,Number(dimensions.height)||29);
  const u=100;
  function startDrag(key,e){
    if(!svgRef.current) return;
    const svg=svgRef.current;
    const rect=svg.getBoundingClientRect();
    dragRef.current={key, startX:e.clientX,startY:e.clientY,width:rect.width,height:rect.height,
      initial:{nameX:settings.nameX,nameY:settings.nameY,numberX:settings.numberX,numberY:settings.numberY,sponsorX:settings.sponsorX,sponsorY:settings.sponsorY}};
    try {svg.setPointerCapture(e.pointerId);}catch{}
  }
  function dragMove(e){
    const d=dragRef.current;
    if(!d) return;
    const dx=(e.clientX-d.startX)/Math.max(d.width,1)*100;
    const dy=(e.clientY-d.startY)/Math.max(d.height,1)*100;
    const keys=grouped && d.key!=='sponsor'?['name','number']:[d.key];
    setSettings(old=>{
      const next={...old};
      for(const key of keys){
        next[key+'X']=Math.max(0,Math.min(100,d.initial[key+'X']+dx));
        next[key+'Y']=Math.max(0,Math.min(100,d.initial[key+'Y']+dy));
      }
      return next;
    });
  }
  function finishDrag(e){dragRef.current=null;try{svgRef.current?.releasePointerCapture(e.pointerId);}catch{}}

  const fontOption=(value,setter)=><select value={value} onChange={e=>setter(e.target.value)} style={{fontFamily:value}}>{!fonts.includes(value)&&<option value={value}>{value}</option>}{fonts.map(f=><option key={f} value={f}>{f}</option>)}</select>;
  const positionBar=(label,k)=><label className="range-field" key={k}><span>{label}<b>{settings[k]}%</b></span><input type="range" min="0" max="100" value={settings[k]} onChange={e=>set(k,Number(e.target.value))}/></label>;
  return <div className="app">
    <aside className={`sidebar ${sidebarOpen?'':'collapsed'}`}>
      <div className="brand"><span className="brand-symbol">JS</span>{sidebarOpen&&<span><strong>JERSEY STUDIO</strong><small>SUBLIMATION WORKSPACE</small></span>}</div>
      <button className="sidebar-toggle" onClick={()=>setSidebarOpen(v=>!v)} title={sidebarOpen?'Collapse workspace menu':'Expand workspace menu'}>{sidebarOpen?'❮':'❯'}<span>{sidebarOpen?' Hide menu':''}</span></button>
      <nav>
        <button className={workspace==='sizing'?'active':''} title="Jersey Sizing" onClick={()=>setWorkspace('sizing')}><span>▦</span>{sidebarOpen&&'Jersey Sizing'}</button>
        <button className={workspace==='vector'?'active':''} title="Image to Vector" onClick={()=>setWorkspace('vector')}><span>✧</span>{sidebarOpen&&'Image to Vector'}</button>
      </nav>
      {sidebarOpen&&<p className="sidebar-foot">PHASE 2 · PNG PRODUCTION<br/>AI reconstruction and OCR improvements will come later.</p>}
    </aside>
    <section className="content">
      <header className="topbar"><div><span className="overline">JERSEY STUDIO / {workspace==='sizing'?'SIZING':'VECTOR'}</span><h1>{workspace==='sizing'?'Production Workspace':'Image to Vector'}</h1></div><span className="build-tag">PHASE 3.1</span></header>
      {notice&&<div className="notice" onClick={()=>setNotice('')}>{notice}<span> ×</span></div>}
      {workspace==='vector' ? <VectorWorkspace/> : <>
      <div className="workbench">
        <section className="asset-panel panel">
          <div className="panel-heading"><h2>Assets & data</h2><span className="tiny-tag">PROJECT</span></div>
          <div className="tabbar"><button className={drawer==='artwork'?'selected':''} onClick={()=>setDrawer('artwork')}>Artwork</button><button className={drawer==='import'?'selected':''} onClick={()=>setDrawer('import')}>Import</button><button className={drawer==='players'?'selected':''} onClick={()=>setDrawer('players')}>Players <small>{players.length}</small></button></div>
          {drawer==='import'?<div className="import-panel"><h3>Import player roster</h3><p className="helper">Upload Excel (.xlsx / .xls), CSV, typed TXT, or an image of a handwritten or printed list. OCR is not guaranteed to read handwriting correctly.</p><label className="subtle full roster-upload">{importBusy?'Reading file...':'↑ Choose roster file'}<input hidden type="file" disabled={importBusy} accept=".xlsx,.xls,.csv,.txt,.tsv,.png,.jpg,.jpeg,.webp,.bmp" onChange={e=>{importRosterFile(e.target.files?.[0]);e.target.value='';}}/></label>{importFileName&&<p className="helper">File: {importFileName}</p>}<div className="divider"/><h3>Or paste/type a list</h3><textarea rows={7} placeholder={'Name,Number,Size,Quantity,Sleeve\nRAHUL,07,38,2,Half\nAMAN,10,40,1,Full'} value={importText} onChange={e=>setImportText(e.target.value)}/><button className="subtle full" disabled={importBusy} onClick={parsePastedText}>Parse typed list</button>{importStatus&&<p className="import-status">{importStatus}</p>}{importResults.length>0&&<><h3>Review extracted players ({importResults.length})</h3><div className="import-review">{importResults.map((p,i)=><div className="import-record" key={p.id}><label>Name<input value={p.name} onChange={e=>setImportResults(rs=>rs.map((r,j)=>i===j?{...r,name:upper(e.target.value)}:r))}/></label><label>No<input value={p.number} onChange={e=>setImportResults(rs=>rs.map((r,j)=>i===j?{...r,number:e.target.value}:r))}/></label><label>Size<input value={p.size} onChange={e=>setImportResults(rs=>rs.map((r,j)=>i===j?{...r,size:e.target.value}:r))}/></label><label>Qty<input type="number" min="1" value={p.quantity} onChange={e=>setImportResults(rs=>rs.map((r,j)=>i===j?{...r,quantity:Math.max(1,Number(e.target.value)||1)}:r))}/></label><label>Sleeve<select value={p.sleeve} onChange={e=>setImportResults(rs=>rs.map((r,j)=>i===j?{...r,sleeve:e.target.value}:r))}><option>Half</option><option>Full</option></select></label><button title="Remove extracted row" onClick={()=>setImportResults(rs=>rs.filter((_,j)=>j!==i))}>×</button></div>)}</div><div className="import-actions"><button onClick={()=>applyImport('replace')}>Replace player list</button><button onClick={()=>applyImport('append')}>Add to player list</button></div></>}</div>:drawer==='artwork'?<div className="asset-list">{uploadTypes.map(([key,label])=><div className="asset-with-delete" key={key}><label className="asset-upload"><span className="thumb">{art[key]?<img src={art[key]} alt=""/>:'＋'}</span><span><strong>{label}</strong><small>{art[key]?'Replace image':'Select artwork'}</small></span><span className="upload-arrow">↗</span><input hidden type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.tif,.tiff" onChange={e=>{readImage(e.target.files?.[0],src=>setArt(a=>({...a,[key]:src})));e.target.value='';}}/></label>{art[key]&&<button className="asset-delete" title={`Remove ${label} artwork`} onClick={()=>setArt(a=>{const next={...a};delete next[key];return next;})}>🗑</button>}</div>)}<p className="helper">All artwork inputs are optional. Uploaded images remain in memory until you refresh.</p></div>:<div className="player-list"><div className="side-tools"><button className="subtle" onClick={addPlayer}>＋ Add player</button><button className="subtle" onClick={csvDownload}>↓ CSV</button><button className="subtle danger" onClick={clearPlayers}>🗑 Clear all</button></div>{players.map((p,i)=><div className={`player-card ${playerIndex===i?'current':''}`} key={p.id}><button className="player-pick" onClick={()=>setPlayerIndex(i)}><strong>{p.name||'Unnamed'}</strong><span>#{p.number||'—'} · {sizeLabel(canonicalSize(p.size,settings.sizes)||p.size)} · Q{p.quantity}</span></button><button className="trash" title="Remove player" onClick={()=>removePlayer(p.id)}>×</button><div className="player-fields"><label>Name<input value={p.name} onChange={e=>changePlayer(p.id,'name',e.target.value)}/></label><label>Number<input value={p.number} onChange={e=>changePlayer(p.id,'number',e.target.value)}/></label><label>Size<select value={p.size} onChange={e=>changePlayer(p.id,'size',e.target.value)}>{!settings.sizes[canonicalSize(p.size,settings.sizes)||p.size]&&<option value={p.size}>⚠ Unknown: {p.size}</option>}{sizes.map(s=><option key={s} value={s}>{sizeLabel(s)}</option>)}</select></label><label>Qty<input type="number" min="1" value={p.quantity} onChange={e=>changePlayer(p.id,'quantity',Math.max(1,Math.floor(Number(e.target.value)||1)))}/></label><label className="wide">Sleeve<select value={p.sleeve} onChange={e=>changePlayer(p.id,'sleeve',e.target.value)}><option>Half</option><option>Full</option></select></label></div></div>)}<p className="helper">{players.length} records · {counts} total jerseys. Use the Import tab to load an Excel/CSV file, typed text or OCR image.</p></div>}
        </section>
        <section className="center-area">
          <div className="canvas-toolbar"><div className="segmented"><button className={side==='back'?'selected':''} onClick={()=>setSide('back')}>Back</button><button className={side==='front'?'selected':''} onClick={()=>setSide('front')}>Front</button><button className={side==='halfSleeve'?'selected':''} onClick={()=>setSide('halfSleeve')}>Half sleeves</button><button className={side==='fullSleeve'?'selected':''} onClick={()=>setSide('fullSleeve')}>Full sleeves</button><button className={side==='collar'?'selected':''} onClick={()=>setSide('collar')}>Collar</button></div><span>{['front','back'].includes(side)?`${dimensions.width} × ${dimensions.height}`:side==='collar'?`${settings.collarWidth} × ${settings.collarHeight}`:side==='halfSleeve'?`${settings.halfWidth*2} × ${settings.halfHeight}`:`${settings.fullWidth*2} × ${settings.fullHeight}`} in</span></div>
          <div className="stage"><div className="print-canvas" style={{aspectRatio:side==='collar'?`${settings.collarWidth}/${settings.collarHeight}`:side==='halfSleeve'?`${settings.halfWidth*2}/${settings.halfHeight}`:side==='fullSleeve'?`${settings.fullWidth*2}/${settings.fullHeight}`:`${realWidth}/${realHeight}`}}>
            {['halfSleeve','fullSleeve'].includes(side) ? <div className="sleeve-dual">{['left','right'].map(which=><div className="sleeve-half" key={which}>{previewSleeveSource(which)?<img src={previewSleeveSource(which)} style={{transform:mirrorPreviewSleeve(which)?'scaleX(-1)':'none'}} alt={`${which} sleeve`}/>:<span>Upload {which} sleeve</span>}<b>{which.toUpperCase()}</b></div>)}</div>:image?<img className="base-art" src={image} alt={`${side} uploaded artwork`}/>:<div className="canvas-empty">Upload {side} artwork<small>The full production page appears here</small></div>}
            <svg ref={svgRef} className="template-overlay" viewBox={`0 0 ${realWidth*u} ${realHeight*u}`} preserveAspectRatio="none"
              onPointerMove={dragMove} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
              {player && side==='back' && <FixedText value={player.name} cx={settings.nameX} cy={settings.nameY} width={settings.nameWidth} height={settings.nameHeight} fontFamily={settings.nameFont} fill={settings.nameFill} stroke={settings.nameStroke} strokeWidth={settings.stroke} selected={activeControl==='name'} onSelect={()=>setActiveControl('name')} onMove={e=>startDrag('name',e)} pageWidth={realWidth} pageHeight={realHeight}/>}
              {player && (side==='back'||settings.frontNumber) && <FixedText value={player.number} cx={side==='back'?settings.numberX:settings.frontPosition==='left'?25:settings.frontPosition==='right'?75:50} cy={side==='back'?settings.numberY:36} width={side==='back'?settings.numberWidth:Math.min(settings.numberWidth,4)} height={side==='back'?settings.numberHeight:Math.min(settings.numberHeight,3)} fontFamily={settings.numberFont} fill={settings.numberFill} stroke={settings.numberStroke} strokeWidth={settings.stroke} selected={activeControl==='number'} onSelect={()=>setActiveControl('number')} onMove={side==='back'?e=>startDrag('number',e):undefined} pageWidth={realWidth} pageHeight={realHeight}/>}
              {side==='back' && settings.sponsorEnabled && <FixedText value={settings.sponsorText} cx={settings.sponsorX} cy={settings.sponsorY} width={settings.sponsorWidth} height={settings.sponsorHeight} fontFamily={settings.nameFont} fill={settings.sponsorFill} stroke="none" strokeWidth={0} selected={activeControl==='sponsor'} onSelect={()=>setActiveControl('sponsor')} onMove={e=>startDrag('sponsor',e)} pageWidth={realWidth} pageHeight={realHeight}/>}
            </svg>
            {player&&['front','back'].includes(side)&&settings.bottomMarkEnabled&&<div className="size-stamp" style={{width:`${settings.bottomMarkWidth/realWidth*100}%`,height:`${settings.bottomMarkHeight/realHeight*100}%`,background:settings.bottomMarkFill,color:settings.bottomMarkTextFill}}>{canonicalSize(player.size,settings.sizes)||player.size}</div>}
            {['front','back'].includes(side)&&settings.topMarkEnabled&&<div className="top-mark" style={{width:`${settings.topMarkWidth/realWidth*100}%`,height:`${settings.topMarkHeight/realHeight*100}%`,background:settings.topMarkFill}}/>}
            {side==='back' && player?.sleeve==='Full' && settings.sleeveMarkEnabled && <div className={`back-sleeve-mark ${settings.sleeveMarkPosition}`} style={{color:settings.sleeveMarkFill,height:`${Math.max(.05,Number(settings.sleeveMarkHeight||.2))/realHeight*100}%`}}>{settings.sleeveMarkText||'FULL SLEEVE'}</div>}
          </div></div>
          <div className="preview-footer"><button onClick={()=>setPlayerIndex(i=>Math.max(0,i-1))} disabled={!players.length||playerIndex===0}>← Previous</button><div><strong>{player?.name||'No player'}</strong><span>{players.length?playerIndex+1:0} / {players.length} · #{player?.number||'—'} · size {player?.size||'—'} · qty {player?.quantity||0}</span></div><button onClick={()=>setPlayerIndex(i=>Math.min(players.length-1,i+1))} disabled={!players.length||playerIndex>=players.length-1}>Next →</button></div>
          <div className="editor-note">Shared template: adjusting any text box or position updates every player. Dashed border = selected element. Drag text to position it. Use the Export panel to generate size-calibrated PNG files. Confirm typography and dimensions before printing.</div>
        </section>
        <aside className="properties panel"><div className="panel-heading"><h2>Properties</h2><span className="tiny-tag">LIVE</span></div><div className="tabbar property-tabs">{[['text','Text'],['layout','Layout'],['parts','Parts']].map(([key,label])=><button key={key} className={settingsTab===key?'selected':''} onClick={()=>setSettingsTab(key)}>{label}</button>)}</div>
          {settingsTab==='text'?<div className="property-content"><h3>Fonts</h3><button className="subtle full" onClick={findLocalFonts}>⌕ Detect installed fonts</button><p className="helper">{fontStatus}</p><label className="field">Name font{fontOption(settings.nameFont,v=>set('nameFont',v))}</label><label className="field">Number font{fontOption(settings.numberFont,v=>set('numberFont',v))}</label><label className="subtle full font-upload">＋ Upload custom font<input hidden type="file" accept=".ttf,.otf,.woff,.woff2" onChange={e=>{uploadFont(e.target.files?.[0]);e.target.value='';}}/></label><div className="divider"/><h3>Text size</h3><div className="two-cols"><Field label="Name pt" value={settings.namePoints} onChange={v=>set('namePoints',v)}/><Field label="Number pt" value={settings.numberPoints} onChange={v=>set('numberPoints',v)}/><Field label="Name width (in)" value={settings.nameWidth} step={.25} onChange={v=>set('nameWidth',v)}/><Field label="Name height (in)" value={settings.nameHeight} step={.1} onChange={v=>set('nameHeight',v)}/><Field label="Number width (in)" value={settings.numberWidth} step={.25} onChange={v=>set('numberWidth',v)}/><Field label="Number height (in)" value={settings.numberHeight} step={.25} onChange={v=>set('numberHeight',v)}/></div><p className="helper">The text now fits each exact inch-sized box in the preview, even for long names. It stretches to fill both dimensions; point sizes remain preferred font metadata for later export.</p><div className="divider"/><h3>Sponsor (optional)</h3><label className="check"><input type="checkbox" checked={settings.sponsorEnabled} onChange={e=>set('sponsorEnabled',e.target.checked)}/>Show editable sponsor text</label><label className="field">Sponsor text<input type="text" value={settings.sponsorText} onChange={e=>set('sponsorText',e.target.value)}/></label><div className="two-cols"><Field label="Sponsor width (in)" value={settings.sponsorWidth} step={.25} onChange={v=>set('sponsorWidth',v)}/><Field label="Sponsor height (in)" value={settings.sponsorHeight} step={.1} onChange={v=>set('sponsorHeight',v)}/></div><ColorField label="Sponsor color" value={settings.sponsorFill} onChange={v=>set('sponsorFill',v)}/><p className="helper">Use this only if the sponsor text is not already part of uploaded artwork.</p><div className="divider"/><h3>Text colors</h3><ColorField label="Name fill" value={settings.nameFill} onChange={v=>set('nameFill',v)}/><ColorField label="Name outline" value={settings.nameStroke} onChange={v=>set('nameStroke',v)}/><ColorField label="Number fill" value={settings.numberFill} onChange={v=>set('numberFill',v)}/><ColorField label="Number outline" value={settings.numberStroke} onChange={v=>set('numberStroke',v)}/><Field label="Outline thickness" value={settings.stroke} onChange={v=>set('stroke',v)} step={.5}/></div>:
          settingsTab==='layout'?<div className="property-content"><h3>Size chart profiles</h3><label className="field">Active chart<select value={activeChart} onChange={e=>setActiveChart(e.target.value)}>{Object.keys(chartNames).map(n=><option key={n} value={n}>{n}</option>)}</select></label><div className="profile-actions"><button className="subtle" onClick={createChart}>＋ Create chart</button>{activeChart!=='Standard'&&<button className="subtle danger" onClick={deleteChart}>Delete chart</button>}</div><p className="helper">Standard is your official locked size chart. Create unlimited named copies to customize inches.</p><h3>Page preset</h3><label className="field">Size<select value={settings.editSize} onChange={e=>set('editSize',e.target.value)}>{sizes.map(s=><option key={s} value={s}>{sizeLabel(s)}</option>)}</select></label><div className="two-cols"><Field label="Width (in)" value={settings.sizes[settings.editSize].width} step={.25} onChange={v=>updateDimension('width',v)}/><Field label="Height (in)" value={settings.sizes[settings.editSize].height} step={.25} onChange={v=>updateDimension('height',v)}/></div><button className="subtle full" disabled={activeChart==='Standard'} onClick={addSize}>＋ Add size preset</button><p className="helper">Official size chart loaded automatically. {sizeLabel(currentSize)} uses {dimensions.width} × {dimensions.height} inches. Letter and numeric sizes are interchangeable. Changes are saved.</p><div className="divider"/><h3>Positioning</h3><label className="check"><input type="checkbox" checked={grouped} onChange={e=>setGrouped(e.target.checked)}/>Move name & number together</label><label className="field">Selected element<select value={activeControl} onChange={e=>setActiveControl(e.target.value)}><option value="name">Name</option><option value="number">Number</option><option value="sponsor">Sponsor</option></select></label>{positionBar('Name horizontal','nameX')}{positionBar('Name vertical','nameY')}{positionBar('Number horizontal','numberX')}{positionBar('Number vertical','numberY')}{settings.sponsorEnabled&&positionBar('Sponsor horizontal','sponsorX')}{settings.sponsorEnabled&&positionBar('Sponsor vertical','sponsorY')}<div className="nudge"><button onClick={()=>adjustPosition('x',-1)}>←</button><button onClick={()=>adjustPosition('y',-1)}>↑</button><button onClick={()=>adjustPosition('y',1)}>↓</button><button onClick={()=>adjustPosition('x',1)}>→</button></div><button className="subtle full" onClick={resetPosition}>Reset positions</button><p className="helper">Drag the text directly on the canvas, or use sliders and arrows. These are master-template positions shared by every player.</p></div>:
          <div className="property-content"><h3>Registration marks</h3><label className="check"><input type="checkbox" checked={settings.bottomMarkEnabled} onChange={e=>set('bottomMarkEnabled',e.target.checked)}/>Bottom centered size square (touching edge)</label><div className="two-cols"><Field label="Bottom width (in)" value={settings.bottomMarkWidth} step={.05} onChange={v=>set('bottomMarkWidth',v)}/><Field label="Bottom height (in)" value={settings.bottomMarkHeight} step={.05} onChange={v=>set('bottomMarkHeight',v)}/></div><ColorField label="Bottom box color" value={settings.bottomMarkFill} onChange={v=>set('bottomMarkFill',v)}/><ColorField label="Size text color" value={settings.bottomMarkTextFill} onChange={v=>set('bottomMarkTextFill',v)}/><label className="check"><input type="checkbox" checked={settings.topMarkEnabled} onChange={e=>set('topMarkEnabled',e.target.checked)}/>Top centered rectangle (touching edge)</label><div className="two-cols"><Field label="Top width (in)" value={settings.topMarkWidth} step={.05} onChange={v=>set('topMarkWidth',v)}/><Field label="Top height (in)" value={settings.topMarkHeight} step={.05} onChange={v=>set('topMarkHeight',v)}/></div><ColorField label="Top mark color" value={settings.topMarkFill} onChange={v=>set('topMarkFill',v)}/><div className="divider"/><h3>Back print identifier — Full Sleeve orders only</h3><label className="check"><input type="checkbox" checked={settings.sleeveMarkEnabled} onChange={e=>set('sleeveMarkEnabled',e.target.checked)}/>Mark the BACK print when player sleeve type is Full</label><label className="field">Identifier text (default: FULL SLEEVE)<input type="text" value={settings.sleeveMarkText} onChange={e=>set('sleeveMarkText',e.target.value)}/></label><label className="field">Position<select value={settings.sleeveMarkPosition} onChange={e=>set('sleeveMarkPosition',e.target.value)}><option value="bottom-left">Bottom left (edge)</option><option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option><option value="top-left">Top left</option><option value="top-right">Top right</option></select></label><Field label="Identifier height (in)" step={.05} value={settings.sleeveMarkHeight} onChange={v=>set('sleeveMarkHeight',v)}/><ColorField label="Back identifier color" value={settings.sleeveMarkFill} onChange={v=>set('sleeveMarkFill',v)}/><div className="divider"/><h3>Front number</h3><label className="check"><input type="checkbox" checked={settings.frontNumber} onChange={e=>set('frontNumber',e.target.checked)}/>Enable front number</label><label className="field">Placement<select value={settings.frontPosition} onChange={e=>set('frontPosition',e.target.value)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><div className="divider"/><h3>Half sleeve</h3><div className="two-cols"><Field label="Width (in)" value={settings.halfWidth} onChange={v=>set('halfWidth',v)}/><Field label="Height (in)" value={settings.halfHeight} onChange={v=>set('halfHeight',v)}/></div><h3>Full sleeve</h3><div className="two-cols"><Field label="Width (in)" value={settings.fullWidth} onChange={v=>set('fullWidth',v)}/><Field label="Height (in)" value={settings.fullHeight} onChange={v=>set('fullHeight',v)}/></div><div className="divider"/><h3>Collar</h3><label className="field">Preset<select value={settings.collarType} onChange={e=>{const type=e.target.value;setSettings(s=>({...s,collarType:type,collarWidth:18,collarHeight:type==='shirt'?7:4}));}}><option value="ready">Ready-made</option><option value="shirt">Shirt</option><option value="chinese">Chinese</option></select></label><div className="two-cols"><Field label="Width (in)" value={settings.collarWidth} onChange={v=>set('collarWidth',v)}/><Field label="Height (in)" value={settings.collarHeight} onChange={v=>set('collarHeight',v)}/></div><p className="helper">During export, one uploaded sleeve side is mirrored to generate the opposite. If both sides exist, both originals are kept.</p></div>}
          <div className="export-panel">{invalidPlayers.length>0&&<p className="import-status">⚠ Unknown jersey sizes: {invalidPlayers.map(p=>`${p.name||'Unnamed'} (${p.size})`).join(', ')}. Correct them in Players before export.</p>}
            <h3>Print PNG Export</h3>
            <label className="field">Resolution
              <select value={exportDpi} onChange={e=>setExportDpi(Number(e.target.value))} disabled={exportBusy}>
                <option value={300}>300 DPI · production (high memory)</option>
                <option value={150}>150 DPI · test export</option>
              </select>
            </label>
            <p className="export-summary">{exportJobs.error ? exportJobs.error : `${exportJobs.jobs.length} unique PNG files · ${counts} total jerseys`}</p>
            {exportProgress&&<div className="export-progress"><div className="export-progress-track"><div style={{width:`${exportProgress.total?Math.round(100*exportProgress.done/exportProgress.total):0}%`}}/></div><small>{exportProgress.label}</small></div>}
            <button className="action" disabled={exportBusy||Boolean(exportJobs.error)} onClick={downloadProductionZip}>{exportBusy?'Generating PNG files…':'↓ Download PNG-Only ZIP'}</button>
            <p>Front without numbers: SIZE-QUANTITY.png. Front with numbers: NUMBER-QUANTITY.png. Back files: BACK NAME/PLAYER.png. Sleeves export as one paired left/right sheet; SLEEVES-84 PCS means 42 paired print copies. All files are PNGs. Verify physical sizes before printing.</p>
          </div>
        </aside>
      </div></>}
    </section>
  </div>;
}
export default App;
