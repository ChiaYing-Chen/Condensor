import xlsx from 'xlsx';

try {
  const workbook = xlsx.readFile('TG-1冷凝器銅管管板.xlsx');
  const sheet = workbook.Sheets['IR'];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  
  if (data.length > 0) {
     console.log("Headers:");
     console.log(data[0]);
     console.log("Row 1:");
     console.log(data[1]);
     console.log("Row 20:");
     console.log(data[20]);
  }

} catch (err) {
  console.error(err);
}
