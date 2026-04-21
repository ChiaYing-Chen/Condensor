import fs from 'fs';

const tubes = JSON.parse(fs.readFileSync('src/utils/tubeMap.json', 'utf8'));

// Find x ranges for OL
let minX = Infinity, maxX = -Infinity;
let minCol = Infinity, maxCol = -Infinity;
const olRows = {};

tubes.forEach(t => {
  if (t.zone === 'OL') {
    if(!olRows[t.row]) olRows[t.row] = [];
    olRows[t.row].push(t);
  }
});

// Let's check row 25 (middle of OL)
const r25 = olRows[25];
r25.sort((a,b) => a.x - b.x);

console.log("OL Row 25 tubes:");
console.log(`Lowest X: ${r25[0].x} (Col: ${r25[0].col})`);
console.log(`Highest X: ${r25[r25.length-1].x} (Col: ${r25[r25.length-1].col})`);
