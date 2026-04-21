import xlsx from 'xlsx';

try {
  const workbook = xlsx.readFile('TG-1.xlsx');
  const sheet = workbook.Sheets['IR'];
  const data = xlsx.utils.sheet_to_json(sheet);
  
  const irRows = {};
  
  data.forEach(row => {
    const r = parseInt(row['行/Row'] || row['Row'], 10);
    const c = parseInt(row['列/Col'] || row['Col'], 10);
    if (!isNaN(r) && !isNaN(c)) {
      if(!irRows[r]) irRows[r] = [];
      irRows[r].push(c);
    }
  });

  // Let's check Row 25
  if (irRows[25]) {
    irRows[25].sort((a,b) => a - b);
    console.log("IR Row 25 Columns:");
    console.log(irRows[25]);
  }
  
  // Let's check Row 1 (center)
  if (irRows[1]) {
    irRows[1].sort((a,b) => a - b);
    console.log("IR Row 1 Columns:");
    console.log(irRows[1]);
  }

} catch (err) {
  console.error(err);
}
