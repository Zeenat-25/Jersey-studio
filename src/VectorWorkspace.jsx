import { useEffect, useState } from 'react';
import { loadArtwork } from './artworkImport';
import './VectorWorkspace.css';

const API = 'http://127.0.0.1:8787';
const initialPrompt = 'Reconstruct ONLY the flat, seamless, rectangular sublimation print artwork from this jersey reference. Preserve the visible graphic composition, colors, motifs, and pattern details as faithfully as possible. Remove the person, jersey silhouette, fabric folds, seams, shadows, wrinkles, logos not part of the artwork, background, and perspective. Make a front-facing, full-bleed 2D textile print panel without text or mockup. Where reference details are hidden, create a visually consistent continuation of the visible pattern.';

export default function VectorWorkspace() {
  const [reference, setReference] = useState('');
  const [filename, setFilename] = useState('');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [piece, setPiece] = useState('Front jersey artwork');
  const [result, setResult] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [seed, setSeed] = useState(-1);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [previousSeed, setPreviousSeed] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/health`, { signal: controller.signal })
      .then(r => r.json()).then(d => setConnected(Boolean(d.ready)))
      .catch(() => setConnected(false));
    return () => controller.abort();
  }, []);

  async function upload(file) {
    if (!file) return;
    try {
      setStatus('Reading the reference image...');
      const data = await loadArtwork(file);
      setReference(data);
      setFilename(file.name);
      setResult(''); setAccepted(false);
      setStatus('Reference ready. The AI will generate NEW artwork, not crop the reference.');
    } catch (e) { setStatus(e.message || 'Unable to read image.'); }
  }

  async function generate() {
    if (!reference || busy) return;
    setBusy(true); setAccepted(false); setStatus('Sending reference to the AI backend. Depending on your GPU and model this may take several minutes...');
    try {
      const response = await fetch(`${API}/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data_url: reference, prompt: `${prompt}\nArtwork section: ${piece}.`, seed }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Backend error (${response.status})`);
      if (!data.image_data_url) throw new Error('The model returned no image.');
      setResult(data.image_data_url);
      setPreviousSeed(data.seed);
      setConnected(true);
      setStatus('AI reconstruction completed. Inspect details before accepting; hidden artwork is estimated.');
    } catch (e) {
      setStatus(`Cannot generate: ${e.message}. Make sure the Python backend, ComfyUI, model, and workflow configuration are running.`);
      setConnected(false);
    } finally { setBusy(false); }
  }

  function download() {
    if (!result || !accepted) return;
    const link = document.createElement('a'); link.href = result;
    link.download = `${(filename.replace(/\.[^.]+$/, '') || 'jersey')}-ai-reconstruction.png`;
    document.body.appendChild(link); link.click(); link.remove();
  }

  return <div className="ai-editor">
    <aside className="ai-panel ai-input-panel">
      <div className="ai-section"><h3>1. Reference image</h3><p>Upload a jersey photo, mockup, person wearing a jersey, or flat artwork. PDF/TIFF first pages are supported.</p>
        <label className="ai-upload">{reference ? '↻ Replace reference' : '+ Upload reference'}<input hidden type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.tif,.tiff" onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {reference && <><div className="ai-thumb"><img src={reference} alt="Reference upload" /></div><small className="ai-filename">{filename}</small><button className="ai-secondary" onClick={() => { setReference(''); setResult(''); setAccepted(false); setFilename(''); }}>Remove reference</button></>}
      </div>
      <div className="ai-section"><h3>2. Artwork type</h3><label className="ai-label">Generate artwork for<select value={piece} onChange={e=>setPiece(e.target.value)}><option>Front jersey artwork</option><option>Back jersey artwork</option><option>Half sleeve artwork</option><option>Full sleeve artwork</option><option>Collar artwork</option><option>Full seamless pattern</option></select></label></div>
      <div className="ai-section"><h3>3. Reconstruction instructions</h3><textarea rows={10} value={prompt} onChange={e=>setPrompt(e.target.value)} aria-label="AI reconstruction prompt"/><button className="ai-secondary" onClick={()=>setPrompt(initialPrompt)}>Restore default instructions</button></div>
      <div className="ai-section"><h3>Generation</h3><label className="ai-label">Seed (−1 for random)<input type="number" value={seed} onChange={e=>setSeed(Number(e.target.value))}/></label><button className="ai-primary" disabled={!reference || busy} onClick={generate}>{busy ? 'Generating — please wait...' : result ? '↻ Regenerate with AI' : '✦ Generate rectangular artwork with AI'}</button></div>
    </aside>
    <section className="ai-center">
      <div className="ai-worktop"><strong>AI Reconstruction</strong><span className={`ai-pill ${connected?'online':''}`}>{connected ? 'Backend configured' : 'Backend not connected'}</span></div>
      <div className="ai-preview-grid">
        <div className="ai-view"><div className="ai-view-header">REFERENCE <span>Input</span></div><div className="ai-image-stage">{reference?<img src={reference} alt="Original reference"/>:<div className="ai-placeholder">Upload a reference image to begin</div>}</div></div>
        <div className="ai-view"><div className="ai-view-header">AI-GENERATED ARTWORK <span>Output</span></div><div className="ai-image-stage output">{result?<img src={result} alt="New AI-generated rectangular artwork"/>:<div className="ai-placeholder">{busy?'AI is reconstructing artwork…':'The generated rectangular design will appear here'}</div>}</div></div>
      </div>
      <div className="ai-bottom"><p role="status">{status || 'This workspace generates a new design using a local open-source image model. It does not simply crop or stretch your reference.'}</p>{previousSeed!==null && <span>Used seed: {previousSeed}</span>}</div>
    </section>
    <aside className="ai-panel ai-output-panel"><div className="ai-section"><h3>4. Review result</h3><p>AI can estimate hidden graphics, but cannot guarantee exact reconstruction of areas obscured by fabric folds or a person's body. Verify it before printing.</p><button className="ai-secondary" disabled={!result||busy} onClick={()=>setAccepted(v=>!v)}>{accepted?'✓ Artwork accepted':'Accept generated design'}</button><button className="ai-primary" disabled={!accepted} onClick={download}>↓ Download generated PNG</button></div><div className="ai-section"><h3>5. Vector conversion</h3><p>Editable SVG/EPS tracing is the next implementation stage. PNG is not a vector file.</p><button className="ai-secondary" disabled>Convert accepted PNG to vector — Phase 3.2</button></div><div className="ai-section"><h3>Local AI setup</h3><p>Start ComfyUI with a compatible image-to-image workflow, then run the Python bridge on port 8787. See SETUP_PHASE3_1.txt.</p><button className="ai-secondary" onClick={async()=>{try{const r=await fetch(`${API}/health`);const d=await r.json();setConnected(Boolean(d.ready));setStatus(d.ready?'Backend connected and configured.':`Backend running but needs configuration: ${d.detail||'workflow missing'}`);}catch{setConnected(false);setStatus('Python backend is not running on port 8787.');}}}>Check AI connection</button></div></aside>
  </div>;
}
