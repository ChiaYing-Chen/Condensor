import xlsx from 'xlsx';

try {
  const workbook = xlsx.readFile('TG-1冷凝器銅管管板.xlsx');
  const sheetName = '113年大修後';
  const sheet = workbook.Sheets[sheetName];
  
  // Use sheet_to_json to get an array of arrays
  const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  console.log(`Analyzing visual sheet dimensions. Rows: ${rawData.length}`);
  
  // Print all non-null values to see what text exists
  const textCells = [];
  for (let r = 0; r < rawData.length; r++) {
    const row = rawData[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== null && String(row[c]).trim() !== '') {
        const val = String(row[c]).trim();
        // Ignore the legend texts like "紅色", "圖例", "換管"
        if (!val.includes("色") && !val.includes("例") && !val.includes("管")) {
           textCells.push(`R${r} C${c}: ${val}`);
        }
      }
    }
  }
  
  console.log("Sample of text cells in the grid:");
  console.log(textCells.slice(0, 100));

} catch (err) {
  console.error(err);
}
