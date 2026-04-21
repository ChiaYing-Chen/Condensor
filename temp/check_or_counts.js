import xlsx from 'xlsx';

try {
  const workbook = xlsx.readFile('TG-1.xlsx');
  const sheetOR = workbook.Sheets['OR'];
  const dataOR = xlsx.utils.sheet_to_json(sheetOR);
  
  const counts = {};
  dataOR.forEach(row => {
    const r = parseInt(row['行/Row'] || row['Row'], 10);
    if (!isNaN(r)) {
       counts[r] = (counts[r] || 0) + 1;
    }
  });

  console.log("OR Column Counts by Row:");
  for (let i=1; i<=50; i++) {
     console.log(`Row ${i}: ${counts[i]} columns`);
  }

} catch (err) {
  console.error(err);
}
