import fs from 'fs';

const tubes = JSON.parse(fs.readFileSync('src/utils/tubeMap.json', 'utf8'));
const olTubes = tubes.filter(t => t.zone === 'OL');

let html = '<!DOCTYPE html><html><body style="background: #111; color: white;">';
html += '<div style="position: relative; width: 800px; height: 800px; margin: 50px;">';

const scale = 5;
const offsetX = 400; // center
const offsetY = 400;

olTubes.forEach(t => {
  const cx = offsetX + (t.x * scale);
  const cy = offsetY + (t.y * scale);
  html += `<div style="position: absolute; left: ${cx}px; top: ${cy}px; width: ${scale-1}px; height: ${scale-1}px; background: blue;" title="OL R${t.row} C${t.col} X${t.x} Y${t.y}"></div>`;
});

html += '</div></body></html>';
fs.writeFileSync('test_ol.html', html);
console.log("Created test_ol.html");
