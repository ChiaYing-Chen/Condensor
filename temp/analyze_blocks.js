import fs from 'xlsx';
import jsonFs from 'fs';

try {
  // === STEP 1: 讀取視覺網格 ===
  const grid = JSON.parse(jsonFs.readFileSync('grid_shape_strict.json', 'utf8'));
  const centerX = 98;  // 已確認的垂直中心線

  // === STEP 2: 確認真正的上/下半邊界 ===
  // Grid Row 50: 90 tubes (right)  → 赤道，非常多管，是"過渡"排
  // Grid Row 51: 89 tubes (right)  → 同上，是"過渡"排
  // Grid Row 52: 51 tubes (right)  → IR Row 1 開始！

  // 對比:
  // TG-1 OR Row 1: 28 tubes (= 14 unique cols × 2)
  // TG-1 OR Row 50: 72 tubes (= 36 unique cols × 2)
  // Grid Row 0: 14 tubes → 完美對應 OR Row 1 (14 unique cols)！
  // Grid Row 49: 36 tubes → 完美對應 OR Row 50 (36 unique cols)！

  // 對比 IR:
  // TG-1 IR Row 1: 80 tubes (= 40 unique cols × 2)
  // TG-1 IR Row 49: 32 tubes (= 16 unique cols × 2)
  // Grid Row 52: 51 tubes → 接近 IR Row 1 (40 unique cols)，但不完全一致...

  // 關鍵：Grid Row 52 有 51 個 colored cells，但其中有些是 2 個連續格子代表一個管
  // 所以實際有效管數 = 51 / 2 ≈ 25.5? 不對
  // 等等... Excel 中的管子佔 2 格（每個管佔 2 個 Excel 欄位）
  // 所以 51 colored cells / 2 ≈ 25 管？但 IR Row 1 有 40 管！
  // 這不對...
  
  // 讓我重新分析：前一個版本（舊 Excel）中 centerX = 98，
  // 並且 /2 的做法是為了修正 Excel 的 2格/管 問題。
  // 但如果 Grid Right-Half Row 52 有 51 個 colored cells，
  // 那真實的管數應該是 ~51 個（每個管只佔 1 格）！？
  // 那為什麼之前要 /2？
  
  // 讓我分析 Grid Row 0 的連續格情況
  const r = 0;
  let blocks = [];
  let inBlock = false;
  let start = -1;
  for(let c=centerX+1; c<grid[r].length; c++) {
    if(grid[r][c]===1 && !inBlock) {
      inBlock = true;
      start = c;
    } else if(grid[r][c]===0 && inBlock) {
      inBlock = false;
      blocks.push({start, end: c-1, width: c-start});
    }
  }
  if(inBlock) blocks.push({start, end: grid[r].length-1, width: grid[r].length-start});
  
  console.log(`Grid Row 0 colored blocks: ${blocks.length} blocks`);
  console.log("First 5 blocks:", blocks.slice(0, 5));
  console.log("Last 5 blocks:", blocks.slice(-5));
  
  // Do same for Row 52
  const r2 = 52;
  let blocks2 = [];
  let inBlock2 = false;
  let start2 = -1;
  for(let c=centerX+1; c<grid[r2].length; c++) {
    if(grid[r2][c]===1 && !inBlock2) {
      inBlock2 = true;
      start2 = c;
    } else if(grid[r2][c]===0 && inBlock2) {
      inBlock2 = false;
      blocks2.push({start: start2, end: c-1, width: c-start2});
    }
  }
  if(inBlock2) blocks2.push({start: start2, end: grid[r2].length-1, width: grid[r2].length-start2});
  
  console.log(`\nGrid Row 52 colored blocks: ${blocks2.length} blocks`);
  console.log("First 5 blocks:", blocks2.slice(0, 5));
  console.log("Last 5 blocks:", blocks2.slice(-5));

} catch(e) { console.error(e); }
