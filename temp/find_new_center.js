import fs from 'fs';

const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));

let width = grid[0].length;
let colCounts = new Array(width).fill(0);

for(let r=0; r<grid.length; r++) {
  for(let c=0; c<width; c++) {
     if(grid[r][c] === 1) colCounts[c]++;
  }
}

// Find columns that have significantly fewer tubes to identify the horizontal center
const centerCandidates = [];
for(let c=20; c<width-20; c++) {
  if (colCounts[c] < 10 && colCounts[c-1] > 20 && colCounts[c+1] > 20) {
     centerCandidates.push(c);
  }
}
console.log("Empty or sparse columns that might be the vertical center:");
console.log(centerCandidates);

// Let's also print rows that have significantly more tubes (the equator)
let height = grid.length;
let rowCounts = new Array(height).fill(0);
for(let r=0; r<height; r++) {
  rowCounts[r] = grid[r].filter(v => v===1).length;
}

const equatorCandidates = [];
for (let r=0; r<height; r++) {
  if (rowCounts[r] > 150) {
    equatorCandidates.push({r, count: rowCounts[r]});
  }
}
console.log("\nRows with high tube count (potential horizontal center):");
console.log(equatorCandidates);

