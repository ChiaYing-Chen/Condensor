import fs from 'fs';

const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));
const centerX = 98;

// Count tubes per row in the RIGHT half of the grid
console.log("Grid Right-Half Row Tube Counts (Top Half, Rows 0-50):");
for(let r=0; r<=50; r++) {
  let cnt = 0;
  for(let c=centerX+1; c<grid[r].length; c++) {
    if(grid[r][c]===1) cnt++;
  }
  console.log(`Grid Row ${r}: ${cnt} tubes`);
}

console.log("\nGrid Right-Half Row Tube Counts (Bottom Half, Rows 51-103):");
for(let r=51; r<grid.length; r++) {
  let cnt = 0;
  for(let c=centerX+1; c<grid[r].length; c++) {
    if(grid[r][c]===1) cnt++;
  }
  if(cnt>0) console.log(`Grid Row ${r}: ${cnt} tubes`);
}
