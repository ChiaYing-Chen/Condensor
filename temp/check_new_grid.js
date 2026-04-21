import fs from 'fs';

const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));

// Check symmetry and dimensions
let height = grid.length;
let width = grid[0].length;

console.log(`Grid Height: ${height}, Grid Width: ${width}`);

// Find the center X by counting tubes per column
let colCounts = new Array(width).fill(0);
for(let r=0; r<height; r++) {
  for(let c=0; c<width; c++) {
     if(grid[r][c] === 1) colCounts[c]++;
  }
}

// Print middle columns
console.log("Middle column counts:");
for(let c = Math.floor(width/2) - 10; c < Math.floor(width/2) + 10; c++) {
  console.log(`Col ${c}: ${colCounts[c]}`);
}

// Find center Y by counting tubes per row
let rowCounts = new Array(height).fill(0);
for(let r=0; r<height; r++) {
  rowCounts[r] = grid[r].filter(v => v===1).length;
}

console.log("\nMiddle row counts:");
for(let r = Math.floor(height/2) - 10; r < Math.floor(height/2) + 10; r++) {
  console.log(`Row ${r}: ${rowCounts[r]}`);
}
