import xlsx from 'xlsx';

try {
  const workbook = xlsx.readFile('TG-1冷凝器銅管管板.xlsx');
  const sheetName = '113年大修後';
  const sheet = workbook.Sheets[sheetName];
  
  const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Find the row that contains 'C' markers (probably around the middle, where yellow line is)
  // Let's print rows that have many 'C' or numbers.
  
  for (let r = 0; r < rawData.length; r++) {
    const row = rawData[r] || [];
    const texts = row.filter(x => x !== null && String(x).trim() !== '');
    if (texts.length > 20) {
      console.log(`Row ${r} has ${texts.length} texts:`);
      
      const parts = [];
      for(let c=0; c<row.length; c++) {
         if (row[c] !== null && String(row[c]).trim() !== '') {
            parts.push(`[C${c}]: ${row[c]}`);
         }
      }
      console.log(parts.join(' | '));
    }
  }

} catch (err) {
  console.error(err);
}
