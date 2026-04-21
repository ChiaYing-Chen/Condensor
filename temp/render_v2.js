import fs from 'fs';

const tubes = JSON.parse(fs.readFileSync('src/utils/tubeMap.json', 'utf8'));

let minX = Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
tubes.forEach(t => {
  if(t.x < minX) minX = t.x;
  if(t.x > maxX) maxX = t.x;
  if(t.y < minY) minY = t.y;
  if(t.y > maxY) maxY = t.y;
});

const W = 1200, H = 800;
const padding = 20;
const scale = Math.min((W-padding*2)/(maxX-minX), (H-padding*2)/(maxY-minY));
const offsetX = W/2 - ((maxX+minX)/2)*scale;
const offsetY = H/2 - ((maxY+minY)/2)*scale;

const zoneColors = {
  OR: '#00b4d8',
  OL: '#0077b6',
  IR: '#90e0ef',
  IL: '#48cae4',
};

let html = `<!DOCTYPE html>
<html>
<body style="background:#0d1117; margin:0; padding:10px;">
<h3 style="color:white; font-family:sans-serif; text-align:center; margin:5px 0">
  管板可視化 (${tubes.length} 支管) - OR藍/OL深藍/IR淺藍/IL青
</h3>
<div style="position:relative; width:${W}px; height:${H}px; background:#0a0f1a; border-radius:8px; margin:auto;">
`;

const r = 2;
tubes.forEach(t => {
  const cx = offsetX + t.x * scale;
  const cy = offsetY + t.y * scale;
  const color = zoneColors[t.zone] || '#555';
  html += `<div style="position:absolute;left:${cx-r}px;top:${cy-r}px;width:${r*2}px;height:${r*2}px;background:${color};border-radius:50%;" title="${t.zone} R${t.row} C${t.col}"></div>`;
});

html += `</div></body></html>`;
fs.writeFileSync('test_tubemap_v2.html', html);
console.log('Saved test_tubemap_v2.html');
