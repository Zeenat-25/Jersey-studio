JERSEY STUDIO SIZING V4 - BACKED-UP SOURCE UPDATE

Extract this entire folder INSIDE the existing jersey-studio folder (beside package.json).
Double-click APPLY_UPDATE.bat. This creates FULL updated files:
  src/App.jsx
  src/exportEngine.js
  src/App.css
  src/sizeChart.js
  src/sizingMath.js

ALL originals are backed up OUTSIDE the Git repository under
  .../Jersey Design/JerseyStudio_Sizing_Backups/<timestamp>

Changes:
- Standard size chart matches user reference (6M 12x18, 1-2Y 13x19, etc.).
- Standard chart width and height fields disabled; custom named charts remain editable.
- M (21x29) becomes master for name, number, top and bottom marks.
- Name max box 20x1.86 in; number max box 11.5x6 in; markings .5x.5 and .1x.3 in.
- Text uses proportional CONTAIN sizing (no stretching or distortion of characters).
- Empty jersey numbers no longer block ZIP export; names still required.
- No changes to AI/vector importer or other workspace components.

After successful build: npm run dev, test sizes 20,26,38,40,46, and blank numbers.
Git update when happy:
  git add src/App.jsx src/App.css src/exportEngine.js src/sizeChart.js src/sizingMath.js
  git commit -m "Fix standard chart and responsive jersey typography"
  git push origin main
Vercel linked to GitHub should redeploy on push.

If 'STOPPED SAFELY' appears, your source differs from GitHub snapshot; no files changed.
