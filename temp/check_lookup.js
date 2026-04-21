import fs from 'fs';

const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));
const centerY_OR = 50; 
const centerX = 98; // verify this against find_new_center? wait new grid is 299 wide. The output from find_new_center was: center is [149]!
console.log("WAIT IS THE CENTER 149??");

// Let's print out what center was!
let width = grid[0].length;
let colCounts = new Array(width).fill(0);
for(let r=0; r<grid.length; r++) {
  for(let c=0; c<width; c++) {
     if(grid[r][c] === 1) colCounts[c]++;
  }
}
const cCand = [];
for(let c=20; c<width-20; c++) {
  if (colCounts[c] < 10 && colCounts[c-1] > 20 && colCounts[c+1] > 20) {
     cCand.push(c);
  }
}
console.log("Center is:", cCand);

// Print the gap for grid[49] using Center=149? Let's check!
let r = 49;
for (let c = 149 + 1; c < grid[r].length; c++) {
   if (grid[r][c] === 1) {
      console.log(`Grid Row ${r} first tube at ${c}. Offset from 149: ${(c - 149)/2}`);
      break;
   }
}

r = 0;
for (let c = 149 + 1; c < grid[r].length; c++) {
   if (grid[r][c] === 1) {
      console.log(`Grid Row ${r} first tube at ${c}. Offset from 149: ${(c - 149)/2}`);
      break;
   }
}

