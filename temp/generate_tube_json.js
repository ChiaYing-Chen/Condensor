import xlsx from 'xlsx';
import fs from 'fs';

try {
  const workbook = xlsx.readFile('TG-1.xlsx');
  const tubes = [];
  const uniqueKeys = new Set();

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

          // Top Half (OL/OR): Row 1 is the very top, Row 50 is the center.
          // So Row 1 -> y = -50, Row 50 -> y = -1
          // Bottom Half (IL/IR): Row 1 is the center, Row 49 is the very bottom.
          // So Row 1 -> y = 1, Row 49 -> y = 49
          
          if (z === 'OL') {
            x = -c;
            y = -(51 - r);
          } else if (z === 'OR') {
            x = c;
            y = -(51 - r);
          } else if (z === 'IL') {
            x = -c;
            y = r;
          } else if (z === 'IR') {
            x = c;
            y = r;
          } else {
            console.warn(`Unknown zone: ${z}`);
          }

          tubes.push({ id, zone: z, row: r, col: c, x, y });
        }
      }
    });
  });

  fs.writeFileSync('src/utils/tubeMap.json', JSON.stringify(tubes, null, 2));
  console.log(`Successfully generated tubeMap.json with ${tubes.length} tubes.`);

} catch (err) {
  console.error(err);
}
