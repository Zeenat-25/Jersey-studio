"""Creates entire updated source files on YOUR PC from your existing sources.
Safely stops if the expected source structure is not present. Keeps complete backups.
"""
from pathlib import Path
import shutil, datetime, sys, re

HERE=Path(__file__).resolve().parent
PROJECT=HERE.parent
SRC=PROJECT/'src'
TARGETS=['App.jsx','exportEngine.js','App.css','sizeChart.js']

def replace_once(data, old, new, label):
    count=data.count(old)
    if count!=1:
        raise ValueError(f"{label}: expected 1 match, found {count}. App code has changed; no files modified.")
    return data.replace(old,new,1)

def prepare():
    for n in TARGETS:
        if not (SRC/n).is_file():
            raise ValueError(f"Missing {SRC/n}; place this folder beside src and package.json.")
    app=(SRC/'App.jsx').read_text(encoding='utf-8')
    exp=(SRC/'exportEngine.js').read_text(encoding='utf-8')
    css=(SRC/'App.css').read_text(encoding='utf-8')
    chart=(HERE/'sizeChart.js').read_text(encoding='utf-8')
    math=(HERE/'sizingMath.js').read_text(encoding='utf-8')
    if "export const SIZE_CHART" not in chart: raise ValueError('Broken size chart source.')

    app=replace_once(app,"import { loadArtwork } from './artworkImport';", "import { loadArtwork } from './artworkImport';\nimport { scaleBox, containScale } from './sizingMath';",'App sizingMath import')
    app=replace_once(app,"namePoints:195, numberPoints:625, nameWidth:12, nameHeight:1.65, numberWidth:8, numberHeight:6", "namePoints:195, numberPoints:625, nameWidth:20, nameHeight:1.86, numberWidth:11.5, numberHeight:6",'M-master default dimensions')
    app=replace_once(app,
      "const [settings,setSettings]=useState(()=>{const saved=fromStorage('js-settings',{});return {...initialSettings,...saved,editSize:canonicalSize(saved.editSize||'38',saved.sizes)||'38',sizes:migrateSizePresets(saved.sizes)};});",
      "const [settings,setSettings]=useState(()=>{const saved=fromStorage('js-settings',{});const firstV4=localStorage.getItem('js-sizing-v4')!=='1';const newBoxes=firstV4?{nameWidth:20,nameHeight:1.86,numberWidth:11.5,numberHeight:6}:{};if(firstV4)localStorage.setItem('js-sizing-v4','1');return {...initialSettings,...saved,...newBoxes,editSize:canonicalSize(saved.editSize||'38',saved.sizes)||'38',sizes:migrateSizePresets(saved.sizes)};});",'saved settings migration')
    app=replace_once(app,
      "  const sx = boxW / bounds.width;\n  const sy = boxH / bounds.height;",
      "  // Preserve glyph proportions: fit INSIDE the shared box, never stretch.\n  const s = containScale(bounds.width, bounds.height, boxW, boxH);\n  const sx = s;\n  const sy = s;",'proportional SVG text')
    app=replace_once(app,"  const u=100;", "  const u=100;\n  const scaledBox=(w,h)=>scaleBox(w,h,realWidth,realHeight);",'preview sizing helper')
    app=replace_once(app, "width={settings.nameWidth} height={settings.nameHeight}", "width={scaledBox(settings.nameWidth,settings.nameHeight).width} height={scaledBox(settings.nameWidth,settings.nameHeight).height}",'preview name')
    app=replace_once(app, "width={side==='back'?settings.numberWidth:Math.min(settings.numberWidth,4)} height={side==='back'?settings.numberHeight:Math.min(settings.numberHeight,3)}", "width={scaledBox(side==='back'?settings.numberWidth:Math.min(settings.numberWidth,4),side==='back'?settings.numberHeight:Math.min(settings.numberHeight,3)).width} height={scaledBox(side==='back'?settings.numberWidth:Math.min(settings.numberWidth,4),side==='back'?settings.numberHeight:Math.min(settings.numberHeight,3)).height}",'preview number')
    app=replace_once(app, "width={`\u0024{settings.bottomMarkWidth/realWidth*100}%`}", "width={`\u0024{scaledBox(settings.bottomMarkWidth,settings.bottomMarkHeight).width/realWidth*100}%`}",'bottom width')
    app=replace_once(app, "height={`\u0024{settings.bottomMarkHeight/realHeight*100}%`}", "height={`\u0024{scaledBox(settings.bottomMarkWidth,settings.bottomMarkHeight).height/realHeight*100}%`}",'bottom height')
    app=replace_once(app, "width={`\u0024{settings.topMarkWidth/realWidth*100}%`}", "width={`\u0024{scaledBox(settings.topMarkWidth,settings.topMarkHeight).width/realWidth*100}%`}",'top width')
    app=replace_once(app, "height={`\u0024{settings.topMarkHeight/realHeight*100}%`}", "height={`\u0024{scaledBox(settings.topMarkWidth,settings.topMarkHeight).height/realHeight*100}%`}",'top height')
    app=replace_once(app,
      "It stretches to fill both dimensions; point sizes remain preferred font metadata for later export.",
      "Text keeps its natural letter proportions inside the box. Dimensions are based on the M-size master and scale automatically for each size.", 'UI explanation')
    app=replace_once(app,
      "function Field({label,value,onChange,type='number',step=1,min=0}){return <label className=\"field\"><span>{label}</span><input type={type} step={step} min={min} value={value} onChange={e=>onChange(type==='number'?Number(e.target.value):e.target.value)}/></label>;}",
      "function Field({label,value,onChange,type='number',step=1,min=0,disabled=false}){return <label className=\"field\"><span>{label}</span><input type={type} step={step} min={min} value={value} disabled={disabled} onChange={e=>onChange(type==='number'?Number(e.target.value):e.target.value)}/></label>;}", 'locked standard field')
    app=replace_once(app, '<Field label="Width (in)" value={settings.sizes[settings.editSize].width}', '<Field label="Width (in)" disabled={activeChart===\'Standard\'} value={settings.sizes[settings.editSize].width}', 'standard width lock')
    app=replace_once(app, '<Field label="Height (in)" value={settings.sizes[settings.editSize].height}', '<Field label="Height (in)" disabled={activeChart===\'Standard\'} value={settings.sizes[settings.editSize].height}', 'standard height lock')

    exp=replace_once(exp, "import JSZip from 'jszip';", "import JSZip from 'jszip';\nimport { scaleBox, containScale } from './sizingMath';", 'export sizing import')
    exp=replace_once(exp, "    if (!String(p.number ?? '').trim()) throw new Error(`Player ${i + 1} has no number.`);\n", '', 'allow blank player number')
    exp=replace_once(exp,
      "  ctx.scale(width / sourceW, height / sourceH);",
      "  const scale = containScale(sourceW, sourceH, width, height);\n  ctx.scale(scale, scale);", 'export glyph aspect ratio')
    exp=replace_once(exp,
      "  const h = settings[isSponsor ? 'sponsorHeight' : isName ? 'nameHeight' : 'numberHeight'];\n  drawFittedText(ctx, value, {",
      "  const h = settings[isSponsor ? 'sponsorHeight' : isName ? 'nameHeight' : 'numberHeight'];\n  const box = isSponsor ? {width:w,height:h} : scaleBox(w,h,width,height);\n  drawFittedText(ctx, value, {",'export sizing box')
    exp=replace_once(exp, "width: inches(w, `${kind} box width`) * dpi,\n    height: inches(h, `${kind} box height`) * dpi,", "width: inches(box.width, `${kind} box width`) * dpi,\n    height: inches(box.height, `${kind} box height`) * dpi,",'export text dimensions')
    exp=replace_once(exp, "const w=Math.max(1,Number(settings.topMarkWidth??0.1)*dpi),h=Math.max(1,Number(settings.topMarkHeight??0.3)*dpi);", "const mark=scaleBox(settings.topMarkWidth??0.1,settings.topMarkHeight??0.3,widthPx/dpi,heightPx/dpi);\n   const w=Math.max(1,mark.width*dpi),h=Math.max(1,mark.height*dpi);",'top print mark')
    exp=replace_once(exp, "const w=Math.max(1,Number(settings.bottomMarkWidth??0.5)*dpi),h=Math.max(1,Number(settings.bottomMarkHeight??0.5)*dpi);", "const mark=scaleBox(settings.bottomMarkWidth??0.5,settings.bottomMarkHeight??0.5,widthPx/dpi,heightPx/dpi);\n   const w=Math.max(1,mark.width*dpi),h=Math.max(1,mark.height*dpi);",'bottom print mark')
    # Registration lettering must stay readable; it is centered within the scaled mark.
    css += "\n/* V4 sizing: mark dimensions truly follow per-size inch scale, no fixed min-width/padding. */\n.size-stamp{min-width:0!important;padding:0!important;display:flex;align-items:center;justify-content:center;line-height:1;overflow:hidden;font-size:clamp(4px,.7vw,11px)}\n.top-mark{min-width:0!important;padding:0!important}\n.field input:disabled{opacity:.6;cursor:not-allowed}\n"
    return {'App.jsx':app,'exportEngine.js':exp,'App.css':css,'sizeChart.js':chart,'sizingMath.js':math}

def main():
    if not (PROJECT/'package.json').is_file():
        print('ERROR: Extract this kit directly inside your jersey-studio folder, beside package.json and src.')
        return 1
    try: outputs=prepare()
    except Exception as e:
        print('STOPPED SAFELY:',e)
        return 1
    stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    backups=PROJECT.parent/'JerseyStudio_Sizing_Backups'/stamp
    backups.mkdir(parents=True,exist_ok=False)
    for n in TARGETS:
        shutil.copy2(SRC/n,backups/n)
    try:
        for n,data in outputs.items():
            (SRC/n).write_text(data,encoding='utf-8')
    except Exception as e:
        for n in TARGETS: shutil.copy2(backups/n,SRC/n)
        print('WRITE ERROR, original files restored:',e)
        return 1
    print('SUCCESS. Complete updated source files saved in',SRC)
    print('Original files backed up at',backups)
    print('Now run: npm run build')
    return 0

if __name__=='__main__':sys.exit(main())
