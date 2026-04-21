import xlsx from 'xlsx';

try {
  // Read the workbook
  const workbook = xlsx.readFile('TG-1.xlsx');
  let totalTubes = 0;
  const zones = {};

  // For each sheet (IR, IL, OR, OL)
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    // Convert to JSON
    const data = xlsx.utils.sheet_to_json(sheet);
    
    // Use a Set to count unique tubes in this sheet
    const uniqueTubes = new Set();
    
    let minRow = Infinity, maxRow = -Infinity;
    let minCol = Infinity, maxCol = -Infinity;

    data.forEach(row => {
      const z = row['區域/Zone'] || row['Zone'];
      const r = row['行/Row'] || row['Row'];
      const c = row['列/Col'] || row['Col'];
      
      if (z && r !== undefined && c !== undefined) {
        uniqueTubes.add(`${z}-${r}-${c}`);
        
        if (r < minRow) minRow = r;
        if (r > maxRow) maxRow = r;
        if (c < minCol) minCol = c;
        if (c > maxCol) maxCol = c;
      }
    });

    zones[sheetName] = {
      count: uniqueTubes.size,
      rowRange: `${minRow} to ${maxRow}`,
      colRange: `${minCol} to ${maxCol}`
    };
    
    totalTubes += uniqueTubes.size;
  });

  console.log("=== TG-1.xlsx Analysis ===");
  console.log("Total unique tubes across all sheets:", totalTubes);
  console.log("Breakdown by sheet:");
  console.table(zones);

} catch (err) {
  console.error("Error reading xlsx:", err);
}
