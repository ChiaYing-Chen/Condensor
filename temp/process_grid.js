import fs from 'fs';

try {
  const grid = JSON.parse(fs.readFileSync('grid_shape.json', 'utf8'));
  
  let totalTubes = 0;
  // Let's analyze bounds
  let minR = Infinity, maxR = -Infinity;
  let minC = Infinity, maxC = -Infinity;
  
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === 1) {
        totalTubes++;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  
  console.log(`Total tubes found in color map: ${totalTubes}`);
  console.log(`Row bounds: ${minR} to ${maxR}`);
  console.log(`Col bounds: ${minC} to ${maxC}`);
  
  // Find Center X and Y
  const centerR = Math.floor((minR + maxR) / 2);
  const centerC = Math.floor((minC + maxC) / 2);
  
  const tubes = [];
  
  // Keep track of counts for Row / Col numbering per quadrant
  // IR: Bottom Right. Row starts from center going down, Col starts from center going right.
  // IL: Bottom Left. Row starts from center going down, Col starts from center going left.
  // OR: Top Right. Row starts from center going UP, Col starts from center going right.
  // OL: Top Left. Row starts from center going UP, Col starts from center going left.
  
  let tubesMapped = 0;
  
  for (let r = 0; r < grid.length; r++) {
     let rowCounters = { 'IR': 0, 'IL': 0, 'OR': 0, 'OL': 0 };
     // For typical row counting, we need to know the 'Row' number.
     // In Excel, the 'Row' number goes from 1 to 50 on the top half, 1 to 49 on the bottom half.
     // But wait! If we extract x and y directly from the grid offsets:
     
     // x is just c - centerC
     // y is just r - centerR
     
     // However, the ID requires Zone, Row, Col to match the data mapping!!!
     // The data in Excel expects specific Row / Col values.
     // How do we assign "Row" and "Col" to each tube so it EXACTLY matches the data array?
     // From earlier observation: "Col" increases from the center outwards.
     // "Row" increases from the top-edge downwards in the TOP half? No, from center downwards in the BOTTOM half.
     // Top half `Row` went 1 to 50. Row 1 is the Top-most, Row 50 is center.
     // Bottom half `Row` went 1 to 49. Row 1 is center, Row 49 is Bottom-most.
  }
  
  // Actually, wait! The best way to map physical X, Y to the provided Row, Col is:
  // For each physical row on the grid:
  // For the Top Left (OL), there are exactly a certain number of tubes in each physical row. 
  // Let's just output the visual grid matrix first to confirm its shape!
  // It's much easier to just map each (Zone, Row, Col) pair directly onto the contiguous cells.
  
} catch (err) {
  console.error(err);
}
