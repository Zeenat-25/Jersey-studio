import {useEffect,useMemo,useRef,useState} from 'react';
import {exportProductionZip,renderReviewThumbnail} from './exportEngine';
import './ExportReview.css';

const PAGE_SIZE=9;
const FILTERS=[['all','All'],['back','Back'],['front','Front'],['sleeve','Sleeves'],['collar','Collar'],['backPaper','Back paper']];
const FORMATS=['PNG','JPG','TIFF','PDF'];
const formatNum=n=>Number(n).toLocaleString();

function toImg(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src;});}
function saveBlob(blob,filename){const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);}

async function screenshotPage(entries,pageIndex,sectionTitle){
  // Generated from the complete export inventory, not the browser viewport.
  // Consequently scrolling and the number of visible cards cannot omit any entry.
  const colW=360,cardW=330,photoH=400,labelH=70,space=24,margin=32;
  const columns=Math.min(3,Math.max(1,entries.length));
  const rows=Math.ceil(entries.length/columns);
  const canvas=document.createElement('canvas');canvas.width=margin*2+colW*columns;
  canvas.height=164+(photoH+labelH+space)*rows+margin;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#f5f7fb';ctx.fillRect(0,0,canvas.width,canvas.height);
  const maxHeadingWidth=canvas.width-margin*2;
  ctx.fillStyle='#142a52';
  ctx.font='bold 31px Arial';
  const brand='JERSEY STUDIO';
  const suffix=` • ${sectionTitle}`;
  if(ctx.measureText(brand+suffix).width<=maxHeadingWidth){
    ctx.fillText(brand+suffix,margin,51);
  }else{
    // Two separate lines so the full studio brand is never clipped on narrow pages.
    ctx.fillText(brand,margin,45);
    let font=24;
    do{ctx.font=`bold ${font}px Arial`;font--;}while(font>11&&ctx.measureText(sectionTitle).width>maxHeadingWidth);
    ctx.fillText(sectionTitle,margin,75);
  }
  ctx.fillStyle='#526079';ctx.font='16px Arial';ctx.fillText(`Page ${pageIndex+1} • ${entries.length} files • ${new Date().toLocaleDateString()}`,margin,101);
  for(let i=0;i<entries.length;i++){
    const {job,src}=entries[i];const c=i%columns,r=Math.floor(i/columns),x=margin+c*colW,y=136+r*(photoH+labelH+space);
    ctx.fillStyle='#ffffff';ctx.fillRect(x,y,cardW,photoH+labelH);
    ctx.strokeStyle='#d7e0ee';ctx.strokeRect(x+.5,y+.5,cardW-1,photoH+labelH-1);
    try{
      const img=await toImg(src);
      const sc=Math.min((cardW-24)/img.width,(photoH-24)/img.height);
      const w=img.width*sc,h=img.height*sc;
      ctx.drawImage(img,x+(cardW-w)/2,y+(photoH-h)/2,w,h);
    }catch{
      ctx.fillStyle='#9a2434';ctx.font='16px Arial';ctx.fillText('Preview unavailable',x+12,y+photoH/2);
    }
    ctx.fillStyle='#172443';ctx.font='bold 15px Arial';
    const label=job.path;
    // Wrap long filenames instead of truncating entries off-screen.
    const chunks=label.match(/.{1,37}/g)||[label];
    chunks.slice(0,2).forEach((chunk,index)=>ctx.fillText(chunk,x+12,y+photoH+21+index*18));
    ctx.fillStyle='#576680';ctx.font='13px Arial';
    ctx.fillText(`${job.dims[0]} × ${job.dims[1]} in · Qty ${job.quantity}`,x+12,y+photoH+60);
  }
  return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Screenshot encoding failed')),'image/png'));
}

export function ExportReview({jobs,players,settings,artwork,dpi,onClose}){
  const [activeFilter,setActiveFilter]=useState('all');
  const [previews,setPreviews]=useState({});
  const [screenshots,setScreenshots]=useState([]);
  const [working,setWorking]=useState(false);
  const [loaded,setLoaded]=useState(0);
  const [format,setFormat]=useState('PNG');
  const [message,setMessage]=useState('');
  const [busyLabel,setBusyLabel]=useState('');
  const [zoom,setZoom]=useState(null);
  const urls=useRef([]);
  const shots=useRef([]);
  const allReady=loaded===jobs.length;
  const filtered=useMemo(()=>jobs.filter(j=>activeFilter==='all'||j.part===activeFilter),[jobs,activeFilter]);
  const screenshotSection = job => job.part === 'sleeve' ? `${job.sleeve||'Sleeve'} sleeve ${job.side||''}` : job.part === 'backPaper' ? 'Back name paper' : job.part === 'back' ? 'Back' : job.part === 'front' ? 'Front' : job.part === 'collar' ? 'Collar' : job.part;
  const pageTotal = screenshots.length;

  useEffect(()=>{
    let alive=true;const created=[];
    setLoaded(0);setPreviews({});setScreenshots([]);
    (async()=>{
      for(let i=0;i<jobs.length;i++){
        if(!alive)break;
        try{
          const url=await renderReviewThumbnail(jobs[i],settings,24);
          if(!alive){URL.revokeObjectURL(url);break;}
          created.push(url);setPreviews(old=>({...old,[i]:url}));
        }catch(err){if(alive)setMessage(`Preview ${i+1}: ${err.message}`);}
        if(alive)setLoaded(i+1);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    })();
    urls.current=created;
    return()=>{alive=false;created.forEach(u=>URL.revokeObjectURL(u));};
  },[jobs,settings]);

  useEffect(()=>{
    if(!allReady||jobs.length===0)return;
    let cancelled=false;
    (async()=>{
      try{
        const all=[];
        for(let i=0;i<jobs.length;i++){
          all.push({job:jobs[i],src:previews[i]||''});
        }
        const generated=[];
        const groups = new Map();
        for (const entry of all) {
          const title = screenshotSection(entry.job);
          if (!groups.has(title)) groups.set(title, []);
          groups.get(title).push(entry);
        }
        for (const [title, entries] of groups) {
          for (let start=0; start<entries.length; start+=PAGE_SIZE) {
            const partPage = Math.floor(start/PAGE_SIZE) + 1;
            const blob=await screenshotPage(entries.slice(start,start+PAGE_SIZE),partPage-1,title);
            const url=URL.createObjectURL(blob);
            generated.push({blob,url,page:partPage,title,total:Math.ceil(entries.length/PAGE_SIZE)});
          }
        }
        if(cancelled)generated.forEach(s=>URL.revokeObjectURL(s.url));
        else{shots.current=generated;setScreenshots(generated);}
      }catch(err){if(!cancelled)setMessage(`Screenshot: ${err.message}`);}
    })();
    return()=>{cancelled=true;shots.current.forEach(s=>URL.revokeObjectURL(s.url));shots.current=[];};
  },[allReady,jobs,previews]);

  async function copyScreenshot(entry){
    try{
      if(!navigator.clipboard?.write||!window.ClipboardItem)throw new Error('Clipboard image copy is unavailable. Use Save PNG.');
      await navigator.clipboard.write([new window.ClipboardItem({'image/png':entry.blob})]);
      setMessage(`${entry.title} page ${entry.page} copied as an image.`);
    }catch(err){setMessage(err.message);}
  }
  async function finalExport(){
    if(working)return;
    setWorking(true);setMessage('');
    try{
      const result=await exportProductionZip({players,settings,artwork,dpi,format,onProgress:x=>setBusyLabel(x.label)});
      setMessage(`Export downloaded: ${result.files} files.`);
    }catch(err){setMessage(`Export failed: ${err.message}`);}
    finally{setWorking(false);setBusyLabel('');}
  }
  return <div className="review-backdrop" role="dialog" aria-modal="true" aria-label="Production export review">
    <div className="review-window">
      <header className="review-header"><div><small>JERSEY STUDIO / EXPORT</small><h2>Production file review</h2><p>All {formatNum(jobs.length)} unique print files are listed below. Review each variation before final export.</p></div><button className="review-close" onClick={onClose}>✕ Back to editor</button></header>
      <div className="review-tools"><div className="review-filters">{FILTERS.map(([code,label])=><button key={code} className={code===activeFilter?'selected':''} onClick={()=>setActiveFilter(code)}>{label}</button>)}</div><div className="review-count">{filtered.length} of {jobs.length} files</div><label>Export type <select value={format} onChange={e=>setFormat(e.target.value)}>{FORMATS.map(x=><option key={x} value={x}>{x}</option>)}</select></label><button className="review-export" onClick={finalExport} disabled={working||!jobs.length}>{working?'Building ZIP…':`Final Export ZIP (${format})`}</button></div>
      <div className="review-content">
        {!allReady&&<p className="review-status">Rendering small previews: {loaded}/{jobs.length}…</p>}
        {message&&<p className="review-status">{message}</p>}
        {busyLabel&&<p className="review-status">{busyLabel}</p>}
        <div className="review-grid">{filtered.map(job=>{const index=jobs.indexOf(job);return <div className="review-item" key={`${job.path}-${index}`}><div className="review-file" title={job.path}>{job.path}</div><button className="review-image" onClick={()=>setZoom(previews[index]||null)} title="Enlarge preview">{previews[index]?<img src={previews[index]} alt={`${job.path} preview`}/>:<span>Generating preview…</span>}</button><div className="review-caption">{job.dims.join(' × ')} in · Quantity {job.quantity} · {job.part}</div></div>})}</div>
        <section className="review-screenshots"><div><h3>Separate screenshots by print part</h3><p>Every print part gets its own screenshot pages, up to nine variations each. No mixed back/front/sleeve sheets.</p></div><div className="review-shot-list">{screenshots.map(entry=><div key={`${entry.title}-${entry.page}`} className="review-shot"><img src={entry.url} alt={`${entry.title} screenshot page ${entry.page}`}/><strong>{entry.title} · Page {entry.page}/{entry.total}</strong><div><button onClick={()=>saveBlob(entry.blob,`JERSEY_${entry.title.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}_PAGE_${entry.page}.png`)}>Save PNG</button><button onClick={()=>copyScreenshot(entry)}>Copy</button></div></div>)}{!screenshots.length&&<p>Preparing grouped screenshots…</p>}</div></section>
      </div>
      <footer className="review-footer"><span>Review screenshot images are for checking; production exports retain the dimensions and format selected above.</span><button className="review-export" disabled={working} onClick={finalExport}>Final Export ZIP</button></footer>
    </div>
    {zoom&&<div className="review-zoom" onClick={()=>setZoom(null)}><button onClick={()=>setZoom(null)}>Close ✕</button><img src={zoom} alt="Large artwork preview"/></div>}
  </div>;
}
