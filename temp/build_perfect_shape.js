import fs from 'fs';

const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));

const centerY_OR = 50;
const centerY_IR = 51;
const centerX = 98;

let countOR = 0;
let countIR = 0;

for (let r = 0; r <= centerY_OR; r++) {
  for (let c = centerX + 1; c < grid[r].length; c++) {
    if (grid[r][c] === 1) countOR++;
  }
}

for (let r = centerY_IR; r < grid.length; r++) {
  for (let c = centerX + 1; c < grid[r].length; c++) {
    if(grid[r][c] === 1) countIR++;
  }
}

console.log(`Tubes in Top Right (OR): ${countOR}`);
console.log(`Tubes in Bottom Right (IR): ${countIR}`);

// Let's generate the final JSON! We will mirror the right side to the left side!
const tubes = [];

// Helper function to add a tube
function addTube(zone, rowIdx, colIdx, physicalX, physicalY) {
  tubes.push({
    id: `${zone}-${rowIdx}-${colIdx}`,
    zone,
    row: rowIdx,
    col: colIdx,
    x: physicalX,
    y: physicalY
  });
}

// Map Top Right (OR) and Top Left (OL)
for (let r = 0; r <= centerY_OR; r++) {
  let relativeRow = 50 - (centerY_OR - r); // r=0 -> Row 0 (Wait, Excel Row 1 is Top-most, meaning r=0 is Row 1)
  let rowNumber = r + 1; // 1 to 51
  
  let colNumber = 1;
  for (let c = centerX + 1; c < grid[r].length; c++) {
    if (grid[r][c] === 1) {
      let py = -(centerY_OR - r); // r=50 -> py=0. r=0 -> py=-50.
      let px = (c - centerX);
      
      addTube('OR', rowNumber, colNumber, px, py);
      // Mirror to OL
      addTube('OL', rowNumber, colNumber, -px, py);
      colNumber++;
    }
  }
}

// Map Bottom Right (IR) and Bottom Left (IL)
for (let r = centerY_IR; r < grid.length; r++) {
  let rowNumber = r - centerY_IR + 1; // r=51 -> Row 1. r=100 -> Row 50.
  
  let colNumber = 1;
  for (let c = centerX + 1; c < grid[r].length; c++) {
    if (grid[r][c] === 1) {
      let py = (r - centerY_IR) + 1; // r=51 -> py=1. r=100 -> py=50.
      let px = (c - centerX);
      
      addTube('IR', rowNumber, colNumber, px, py);
      // Mirror to IL
      addTube('IL', rowNumber, colNumber, -px, py);
      colNumber++;
    }
  }
}

console.log(`Total generated tubes: ${tubes.length} (Expected around 6312)`);
fs.writeFileSync('src/utils/tubeMap.json', JSON.stringify(tubes, null, 2));
console.log('Saved perfect symmetric tubeMap.json to src/utils/tubeMap.json!');

