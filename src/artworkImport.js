import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as UTIF from 'utif';
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
const imageToDataUrl = file => new Promise((resolve,reject)=> {const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Could not read image'));r.readAsDataURL(file)});
function canvasURL(canvas){return canvas.toDataURL('image/png');}
export async function loadArtwork(file) {
 if (!file) throw new Error('Choose a file.');
 const ext=file.name.split('.').pop().toLowerCase();
 if (['png','jpg','jpeg','webp'].includes(ext)) return imageToDataUrl(file);
 if (ext==='pdf') {
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const page=await pdf.getPage(1); const view=page.getViewport({scale:2});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
  const url=canvasURL(canvas); await pdf.destroy();return url;
 }
 if (['tif','tiff'].includes(ext)) {
  const binary=await file.arrayBuffer();const pages=UTIF.decode(binary);
  if (!pages.length) throw new Error('No pages found in TIFF');
  UTIF.decodeImage(binary,pages[0]);const page=pages[0];const rgba=UTIF.toRGBA8(page);
  const canvas=document.createElement('canvas');canvas.width=page.width;canvas.height=page.height;
  const ctx=canvas.getContext('2d');ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba),page.width,page.height),0,0);
  return canvasURL(canvas);
 }
 throw new Error('Supported artwork: JPG, PNG, WebP, PDF and TIFF.');
}
