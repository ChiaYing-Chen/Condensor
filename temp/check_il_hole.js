import xlsx from 'xlsx';

try {
  const workbook = xlsx.readFile('TG-1.xlsx');
  
  // Test IL
  const sheetIL = workbook.Sheets['IL'];
  const dataIL = xlsx.utils.sheet_to_json(sheetIL);
  const rowsIL = {};
  dataIL.forEach(row => {
    const r = parseInt(row['行/Row'] || row['Row'], 10);
    const c = parseInt(row['列/Col'] || row['Col'], 10);
    if (!isNaN(r) && !isNaN(c)) {
      if(!rowsIL[r]) rowsIL[r] = [];
      rowsIL[r].push(c);
    }
  });

  console.log("IL Row 15 columns (where trapezoid hole usually is):");
  console.log(rowsIL[15].sort((a,b)=>a-b));

  // Test IR
  const sheetIR = workbook.Sheets['IR'];
  const dataIR = xlsx.utils.sheet_to_json(sheetIR);
  const rowsIR = {};
  dataIR.forEach(row => {
    const r = parseInt(row['行/Row'] || row['Row'], 10);
    const c = parseInt(row['列/Col'] || row['Col'], 10);
    if (!isNaN(r) && !isNaN(c)) {
      if(!rowsIR[r]) rowsIR[r] = [];
      rowsIR[r].push(c);
    }
  });

  console.log("IR Row 15 columns:");
  console.log(rowsIR[15].sort((a,b)=>a-b));

} catch (err) {
  console.error(err);
}
