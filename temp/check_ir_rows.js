import xlsx from 'xlsx';

try {
  const workbook = xlsx.readFile('TG-1.xlsx');
  
  // Check all sheets
  console.log("Sheets:", workbook.SheetNames);
  
  // Check IR row range
  const sheetIR = workbook.Sheets['IR'];
  const dataIR = xlsx.utils.sheet_to_json(sheetIR);
  const rowsIR = {};
  dataIR.forEach(row => {
    const r = parseInt(row['行/Row'] || row['Row'], 10);
    if (!isNaN(r)) {
      rowsIR[r] = (rowsIR[r] || 0) + 1;
    }
  });
  const irRowKeys = Object.keys(rowsIR).map(Number).sort((a,b)=>a-b);
  console.log(`IR rows: from ${irRowKeys[0]} to ${irRowKeys[irRowKeys.length-1]}`);
  console.log("IR Row counts:");
  irRowKeys.forEach(r => console.log(`  Row ${r}: ${rowsIR[r]} tubes`));

} catch (err) {
  console.error(err);
}
