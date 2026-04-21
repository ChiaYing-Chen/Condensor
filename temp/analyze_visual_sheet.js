import xlsx from 'xlsx';
import fs from 'fs';

try {
  const workbook = xlsx.readFile('TG-1冷凝器銅管管板.xlsx');
  
  // Check the 'IR' sheet
  const sheet = workbook.Sheets['IR'];
  const data = xlsx.utils.sheet_to_json(sheet);
  
  console.log(`IR sheet has ${data.length} records.`);
  if (data.length > 0) {
     console.log(Object.keys(data[0]));
     console.log(data[0]);
  }

} catch (err) {
  console.error(err);
}
