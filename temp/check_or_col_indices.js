import xlsx from 'xlsx';

try {
  const workbook = xlsx.readFile('TG-1.xlsx');
  const sheetOR = workbook.Sheets['OR'];
  const dataOR = xlsx.utils.sheet_to_json(sheetOR);
  
  const cols = {};
  dataOR.forEach(row => {
    const r = parseInt(row['行/Row'] || row['Row'], 10);
    const c = parseInt(row['列/Col'] || row['Col'], 10);
    if (!isNaN(r) && !isNaN(c)) {
       if(!cols[r]) cols[r] = [];
       cols[r].push(c);
    }
  });

  console.log("OR Row 1 columns:");
  console.log(cols[1].sort((a,b)=>a-b));

  console.log("OR Row 50 columns:");
  console.log(cols[50].sort((a,b)=>a-b));

} catch (err) {
  console.error(err);
}
