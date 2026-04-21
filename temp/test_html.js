import fs from 'fs';

const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));

let html = '<html><body style="background: black; padding: 20px;">\n';
html += '<div style="display: flex; flex-direction: column; gap: 1px;">\n';

for (let r = 0; r < grid.length; r++) {
  html += '  <div style="display: flex; gap: 1px;">\n';
  for (let c = 0; c < grid[r].length; c++) {
    const color = grid[r][c] === 1 ? '#0ea5e9' : '#1e293b';
    html += `    <div style="width: 8px; height: 8px; background: ${color};"></div>\n`;
  }
  html += '  </div>\n';
}

html += '</div></body></html>';

fs.writeFileSync('test_render.html', html);
console.log('Saved test_render.html');
