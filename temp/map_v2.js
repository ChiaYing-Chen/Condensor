import fs from 'fs';
import xlsx from 'xlsx';

try {
  // === 讀取視覺網格 ===
  const grid = JSON.parse(fs.readFileSync('grid_shape_strict.json', 'utf8'));

  // === 關鍵發現 ===
  // Grid Row 0 (對應 OR Row 1): 14 個 blocks，從 col 100 開始，間距 2（偶數欄位）
  // Grid Row 52 (對應 IR Row 1): 42 個 blocks，從 col 99 開始，間距 2（奇數欄位）
  // 中心線是 col 98（空白列）
  // OR 的管：col 100, 102, 104... (偶數)
  // IR 的管：col 99, 101, 103... (奇數)
  // OL 的管（鏡像 OR）：col 96, 94, 92... (偶數，往左)
  // IL 的管（鏡像 IR）：col 97, 95, 93... (奇數，往左)

  const centerX = 98;

  // 建立 lookup 表：對每個視覺 Grid Row，記錄右半部的管子「從中心往外」的序號 → 實際 X 座標
  // 上半部 (OR): Grid Row 0-49 對應 OR Row 1-50
  // 下半部 (IR): Grid Row 52-100 對應 IR Row 1-49

  const lookup = { OR: {}, IR: {} };

  // 建立 OR lookup（Grid Row 0-49 → OR Row 1-50）
  for (let r = 0; r <= 49; r++) {
    const rowNumber = r + 1; // OR Row 1 到 50
    lookup.OR[rowNumber] = {};
    let colNumber = 1;
    for (let c = centerX + 1; c < grid[r].length; c++) {
      if (grid[r][c] === 1) {
        // X 座標：以管間距為 2 個格子，偶數位置
        // c=100 → X=1, c=102 → X=2, c=104 → X=3...
        lookup.OR[rowNumber][colNumber] = (c - centerX) / 2;
        colNumber++;
      }
    }
  }

  // 建立 IR lookup（Grid Row 52-100 → IR Row 1-49）
  for (let r = 52; r <= 100; r++) {
    const rowNumber = r - 51; // IR Row 1 到 49
    lookup.IR[rowNumber] = {};
    let colNumber = 1;
    for (let c = centerX + 1; c < grid[r].length; c++) {
      if (grid[r][c] === 1) {
        // IR 從 col 99 開始（奇數），c=99 → X=0.5，但我們要讓 X 從整數開始
        // 用相同的公式：(c - centerX) / 2
        // c=99 → 0.5, c=101 → 1.5, c=103 → 2.5...
        // 對齊 OR 的話，需要 floor 或 round 讓 X 從 1 開始
        lookup.IR[rowNumber][colNumber] = Math.round((c - centerX) / 2);
        colNumber++;
      }
    }
  }

  // === 讀取 TG-1.xlsx 6312 管資料 ===
  const workbook = xlsx.readFile('TG-1.xlsx');
  const tubes = [];
  const uniqueKeys = new Set();
  let matched = 0, fallback = 0;

  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    data.forEach(row => {
      const z = (row['區域/Zone'] || row['Zone'] || sheetName).toString().trim();
      const r = parseInt(row['行/Row'] || row['Row'], 10);
      const c = parseInt(row['列/Col'] || row['Col'], 10);

      if (!isNaN(r) && !isNaN(c)) {
        // 每個管在 TG-1 出現兩次（奇偶欄位），用 half 來去重
        // Col 在原始資料中每個真實管的 Col 出現兩次（如 [1,1,2,2,3,3...]）
        // 只取第一次出現的（去重）
        const id = `${z}-${r}-${c}`;
        if (uniqueKeys.has(id)) return;
        uniqueKeys.add(id);

        // Y 座標計算
        let y = 0;
        if (z === 'OR' || z === 'OL') {
          y = -(51 - r); // OR Row 1 → y=-50 (頂端), OR Row 50 → y=-1 (赤道上方)
        } else {
          y = r; // IR Row 1 → y=1 (赤道下方), IR Row 49 → y=49 (底端)
        }

        // X 座標計算：從 lookup 取得物理位移
        const refZone = (z === 'OL') ? 'OR' : (z === 'IL') ? 'IR' : z;
        let physX = c; // fallback

        if (lookup[refZone] && lookup[refZone][r] && lookup[refZone][r][c] !== undefined) {
          physX = lookup[refZone][r][c];
          matched++;
        } else {
          fallback++;
          physX = c; // fallback: 直接用 col
        }

        // OL/IL 是左側（負 X）
        const x = (z === 'OL' || z === 'IL') ? -physX : physX;

        tubes.push({ id, zone: z, row: r, col: c, x, y });
      }
    });
  });

  fs.writeFileSync('src/utils/tubeMap.json', JSON.stringify(tubes, null, 2));
  console.log(`✅ 成功映射 ${tubes.length} 支管`);
  console.log(`   視覺座標命中: ${matched}`);
  console.log(`   Fallback: ${fallback}`);

  // 驗證：OR Row 1 應該有 14 支管
  const orRow1 = tubes.filter(t => t.zone === 'OR' && t.row === 1);
  console.log(`\nOR Row 1 管數: ${orRow1.length} (期望 14)`);
  console.log(`OR Row 1 X 範圍: ${orRow1.map(t=>t.x).sort((a,b)=>a-b).join(', ')}`);

  // 驗證：IR Row 1 應該有 40 支管
  const irRow1 = tubes.filter(t => t.zone === 'IR' && t.row === 1);
  console.log(`\nIR Row 1 管數: ${irRow1.length} (期望 40)`);
  console.log(`IR Row 1 X 範圍: ${irRow1.map(t=>t.x).sort((a,b)=>a-b).slice(0,5).join(', ')}...`);

} catch(e) { console.error(e); }
