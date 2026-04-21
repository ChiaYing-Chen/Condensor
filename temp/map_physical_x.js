import fs from 'fs';
import xlsx from 'xlsx';

try {
  // 1. Load the Strict Grid extracted from the user's diagram
  const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));
  
  const centerY_OR = 50; // top half bottom edge
  const centerY_IR = 51; // bottom half top edge
  const centerX = 98;
  
  // This will store physical X offset for each Right-side quadrant
  // lookup[Zone][Row][Col] = physical_X
  const lookup = { OR: {}, IR: {} };
  
  // Build OR lookup (Top Half)
  for (let r = 0; r <= centerY_OR; r++) {
    // r=0 is Top-most, meaning Row 1
    // r=49 is near center, meaning Row 50
    // r=50 is the center axis, which might not be mapped in OR tubes.
    let rowNumber = r + 1; // 1 to 51
    lookup.OR[rowNumber] = {};
    
    let colNumber = 1;
    for (let c = centerX + 1; c < grid[r].length; c++) {
      if (grid[r][c] === 1) {
        // Divide by 2 because the visual Excel sheet uses narrow columns (2 columns per tube spacing)
        lookup.OR[rowNumber][colNumber] = (c - centerX) / 2;
        colNumber++;
      }
    }
  }
  
  // Build IR lookup (Bottom Half)
  for (let r = centerY_IR; r < grid.length; r++) {
    // r=51 is Top-most of bottom half (near center), meaning Row 1
    let rowNumber = (r - centerY_IR) + 1; // 1 to 54
    lookup.IR[rowNumber] = {};
    
    let colNumber = 1;
    for (let c = centerX + 1; c < grid[r].length; c++) {
      if (grid[r][c] === 1) {
        lookup.IR[rowNumber][colNumber] = (c - centerX) / 2;
        colNumber++;
      }
    }
  }

  // 2. Read the EXACT 6312 tubes from TG-1.xlsx
  const workbook = xlsx.readFile('TG-1.xlsx');
  const tubes = [];
  const uniqueKeys = new Set();
  
  let matchCount = 0;
  let fallbackCount = 0;

  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    data.forEach(row => {
      const z = row['區域/Zone'] || row['Zone'];
      const r = parseInt(row['行/Row'] || row['Row'], 10);
      const c = parseInt(row['列/Col'] || row['Col'], 10);

      if (z && !isNaN(r) && !isNaN(c)) {
        const id = `${z}-${r}-${c}`;
        
        if (!uniqueKeys.has(id)) {
          uniqueKeys.add(id);
          
          let x = 0;
          let y = 0;

          // Resolve Y physical coordinate
          if (z === 'OL' || z === 'OR') {
             y = -(51 - r); // r=1 -> -50, r=50 -> -1
          } else {
             y = r; // r=1 -> 1, r=49 -> 49
          }
          
          // Resolve X physical coordinate using the visual lookup table!
          // Remember OL mirrors OR, IL mirrors IR
          let refZone = z === 'OL' ? 'OR' : (z === 'IL' ? 'IR' : z);
          
          let physicalX = c; // Fallback to raw Col if not found in lookup
          
          if (lookup[refZone] && lookup[refZone][r] && lookup[refZone][r][c]) {
             physicalX = lookup[refZone][r][c];
             matchCount++;
          } else {
             fallbackCount++;
             // Just space it out like 2 units per tube if falling back
             physicalX = c * 2;
          }
          
          // Apply mirroring
          if (z === 'OL' || z === 'IL') {
             x = -physicalX;
          } else {
             x = physicalX;
          }

          tubes.push({ id, zone: z, row: r, col: c, x, y });
        }
      }
    });
  });

  fs.writeFileSync('src/utils/tubeMap.json', JSON.stringify(tubes, null, 2));
  console.log(`Successfully mapped EXACT ${tubes.length} tubes from TG-1.xlsx data!!`);
  console.log(`Matched with Visual Slits: ${matchCount}. Fallback: ${fallbackCount}`);

} catch (err) {
  console.error(err);
}
