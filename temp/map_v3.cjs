const xlsx = require('xlsx');
const fs = require('fs');

try {
    const lookup = JSON.parse(fs.readFileSync('lookup_precise.json', 'utf8'));
    const workbook = xlsx.readFile('TG-1.xlsx');
    
    const tubes = [];
    const uniqueKeys = new Set();
    
    // Summary counters
    let countOR = 0, countOL = 0, countIR = 0, countIL = 0;
    
    workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);
        
        data.forEach(row => {
            const z = (row['區域/Zone'] || row['Zone'] || sheetName).toString().trim();
            const r = parseInt(row['行/Row'] || row['Row'], 10);
            const c = parseInt(row['列/Col'] || row['Col'], 10);
            
            if (isNaN(r) || isNaN(c)) return;
            
            const id = `${z}-${r}-${c}`;
            if (uniqueKeys.has(id)) return;
            uniqueKeys.add(id);
            
            let x = 0;
            let y = 0;
            
            let rowLookupData = null;
            if (z === 'OR' || z === 'OL') {
                rowLookupData = lookup.TOP[r-1];
                y = -(51 - r);
            } else {
                rowLookupData = lookup.BOTTOM[r-1];
                y = r;
            }
            
            let physX = 0;
            if (rowLookupData && rowLookupData[c-1]) {
                // The visual grid has 2 units per tube. Using /2 to map back to 1.
                // We use Math.round to ensure it lands on an integer x coordinate if possible, 
                // but float is fine for canvas.
                physX = rowLookupData[c-1] / 2;
            } else {
                physX = c; 
            }
            
            x = (z === 'OR' || z === 'IR') ? physX : -physX;
            
            tubes.push({ id, zone: z, row: r, col: c, x, y });
            
            if (z === 'OR') countOR++;
            else if (z === 'OL') countOL++;
            else if (z === 'IR') countIR++;
            else if (z === 'IL') countIL++;
        });
    });

    console.log(`Summary:`);
    console.log(`OR: ${countOR}, OL: ${countOL}, IR: ${countIR}, IL: ${countIL}`);
    console.log(`Total: ${tubes.length}`);

    fs.writeFileSync('src/utils/tubeMap.json', JSON.stringify(tubes, null, 2));
    console.log("Saved tubeMap.json");

} catch(e) {
    console.error(e);
}
