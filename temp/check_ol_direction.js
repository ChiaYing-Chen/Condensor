import xlsx from 'xlsx';

try {
  const workbook = xlsx.readFile('TG-1.xlsx');
  
  // Test OL
  const sheetOL = workbook.Sheets['OL'];
  const dataOL = xlsx.utils.sheet_to_json(sheetOL);
  const rowsOL = {};
  dataOL.forEach(row => {
    const r = parseInt(row['行/Row'] || row['Row'], 10);
    const c = parseInt(row['列/Col'] || row['Col'], 10);
    if (!isNaN(r) && !isNaN(c)) {
      if(!rowsOL[r]) rowsOL[r] = [];
      rowsOL[r].push(c);
    }
  });

  console.log("OL Row 25 columns:");
  console.log(rowsOL[25].sort((a,b)=>a-b).slice(0, 15), "...", rowsOL[25].sort((a,b)=>a-b).slice(-5));
  
  console.log("OL Row 1 columns:");
  console.log(rowsOL[1].sort((a,b)=>a-b).slice(0, 15), "...", rowsOL[1].sort((a,b)=>a-b).slice(-5));

  // Test OR
  const sheetOR = workbook.Sheets['OR'];
  const dataOR = xlsx.utils.sheet_to_json(sheetOR);
  const rowsOR = {};
  dataOR.forEach(row => {
    const r = parseInt(row['行/Row'] || row['Row'], 10);
    const c = parseInt(row['列/Col'] || row['Col'], 10);
    if (!isNaN(r) && !isNaN(c)) {
      if(!rowsOR[r]) rowsOR[r] = [];
      rowsOR[r].push(c);
    }
  });
  
  console.log("OR Row 25 columns:");
  console.log(rowsOR[25].sort((a,b)=>a-b).slice(0, 15), "...", rowsOR[25].sort((a,b)=>a-b).slice(-5));

} catch (err) {
  console.error(err);
}
