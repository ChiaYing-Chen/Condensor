import fs from 'fs';

const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));

// Find the center X by looking for the column that has a consistent empty line or just manual inspection
// Usually the center X is the vertical empty line where the crosshair is.
// Let's count tubes per column to find the center
let colCounts = new Array(grid[0].length).fill(0);
for(let r=0; r<grid.length; r++) {
  for(let c=0; c<grid[r].length; c++) {
     if(grid[r][c] === 1) colCounts[c]++;
  }
}

// Find the horizontal center line. The image 1 shows a thick yellow band in the center.
// The yellow band has no tubes (or maybe it has the C markers)
let rowCounts = new Array(grid.length).fill(0);
for(let r=0; r<grid.length; r++) {
  rowCounts[r] = grid[r].filter(v => v===1).length;
}

console.log("Row tube counts:");
rowCounts.forEach((cnt, i) => console.log(`Row ${i}: ${cnt}`));

console.log("\nCol tube counts (middle section):");
for(let c = 80; c < 150; c++) {
  console.log(`Col ${c}: ${colCounts[c]}`);
}

