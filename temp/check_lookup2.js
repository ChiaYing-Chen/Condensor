import fs from 'fs';

const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));

let r = 49;
for (let c = 98 + 1; c < grid[r].length; c++) {
   if (grid[r][c] === 1) {
      console.log(`Grid Row ${r} first tube at ${c}. Offset from 98: ${(c - 98)/2}`);
      break;
   }
}

r = 0;
for (let c = 98 + 1; c < grid[r].length; c++) {
   if (grid[r][c] === 1) {
      console.log(`Grid Row ${r} first tube at ${c}. Offset from 98: ${(c - 98)/2}`);
      break;
   }
}

