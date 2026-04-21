import fs from 'fs';

const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));

console.log("Checking Top Half (OR) gaps:");
for(let r=0; r<=50; r++) {
  let firstTube = -1;
  for (let c=99; c<grid[r].length; c++) {
    if(grid[r][c]===1) { firstTube = c; break; }
  }
  if (firstTube !== -1) {
    let offset = (firstTube - 98) / 2;
    if (offset > 1.5) console.log(`Row ${r}: Gap offset ${offset}`);
  }
}

console.log("\nChecking Bottom Half (IR) gaps:");
for(let r=51; r<grid.length; r++) {
  let firstTube = -1;
  for (let c=99; c<grid[r].length; c++) {
    if(grid[r][c]===1) { firstTube = c; break; }
  }
  if (firstTube !== -1) {
    let offset = (firstTube - 98) / 2;
    if (offset > 1.5) console.log(`Row ${r}: Gap offset ${offset}`);
  }
}
