/**
 * update_acz_material.js
 * 將 Air Cooling Zone (ACZ) 範圍內的管子材質批次更新為「銅鎳(C71500)」
 * 範圍：TG-1 ~ TG-4，IL 與 IR 區，ROW 1~28，每 row 的 COL 上限如 ACZ_BOUNDARY 定義
 *
 * 執行方式：
 *   node scripts/update_acz_material.js
 * （需先確認 .env 資料庫連線設定正確）
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// ─── ACZ 邊界定義（row → 最大含 col） ───────────────────────────
const ACZ_BOUNDARY = {
  1: 9,  2: 9,  3: 10, 4: 10, 5: 11, 6: 11, 7: 12, 8: 12,
  9: 13, 10: 13, 11: 14, 12: 14, 13: 15, 14: 15, 15: 16, 16: 16,
  17: 17, 18: 17, 19: 18, 20: 18, 21: 19, 22: 19, 23: 20,
  24: 19, 25: 19, 26: 18, 27: 18, 28: 17,
};

const UNITS  = ['TG-1', 'TG-2', 'TG-3', 'TG-4'];
const ZONES  = ['IL', 'IR'];
const MATERIAL = '銅鎳(C71500)';

// ─── 建立 SQL CASE 條件（row_num + col_num 限制） ────────────────
// 利用「(row_num, col_num) IN (...)」方式，為避免 parameter 數量過多
// 先產生 tuple 字串直接內嵌 SQL（都是整數，安全無 injection 風險）
function buildRowColTuples() {
  const tuples = [];
  for (const [rowStr, maxCol] of Object.entries(ACZ_BOUNDARY)) {
    const row = parseInt(rowStr);
    for (let col = 1; col <= maxCol; col++) {
      tuples.push(`(${row},${col})`);
    }
  }
  return tuples.join(',');
}

async function main() {
  const tupleStr = buildRowColTuples();

  // 計算預期更新數量
  const totalPerZone = Object.values(ACZ_BOUNDARY).reduce((s, c) => s + c, 0); // 419
  const expected = UNITS.length * ZONES.length * totalPerZone;
  console.log(`\n====== ACZ 材質批次更新 ======`);
  console.log(`材質更新目標：${MATERIAL}`);
  console.log(`機組：${UNITS.join(', ')}`);
  console.log(`區域：${ZONES.join(', ')}`);
  console.log(`每區管數：${totalPerZone} 支`);
  console.log(`預計更新總數：${expected} 筆（= ${UNITS.length} 機 × ${ZONES.length} 區 × ${totalPerZone}）`);
  console.log(`\n開始更新...`);

  try {
    // 先查詢目前 ACZ 範圍內管數（確認 registry 已初始化）
    const countRes = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM tube_registry
      WHERE unit_id = ANY($1::text[])
        AND zone = ANY($2::text[])
        AND (row_num, col_num) IN (${tupleStr})
    `, [UNITS, ZONES]);

    const existingCount = parseInt(countRes.rows[0].cnt);
    console.log(`資料庫中符合 ACZ 範圍的管子筆數：${existingCount}`);

    if (existingCount === 0) {
      console.warn(`⚠  找不到任何符合範圍的管子，請確認 tube_registry 是否已有資料。`);
      await pool.end();
      return;
    }

    // 執行批次更新
    const updateRes = await pool.query(`
      UPDATE tube_registry
      SET material = $1, updated_at = NOW()
      WHERE unit_id = ANY($2::text[])
        AND zone = ANY($3::text[])
        AND (row_num, col_num) IN (${tupleStr})
    `, [MATERIAL, UNITS, ZONES]);

    console.log(`\n✅ 更新完成！實際更新筆數：${updateRes.rowCount}`);

    // 抽查驗證
    const verifyRes = await pool.query(`
      SELECT unit_id, zone, COUNT(*) AS cnt
      FROM tube_registry
      WHERE material = $1
        AND unit_id = ANY($2::text[])
        AND zone = ANY($3::text[])
      GROUP BY unit_id, zone
      ORDER BY unit_id, zone
    `, [MATERIAL, UNITS, ZONES]);

    console.log(`\n── 各機組/區域驗證 ──`);
    verifyRes.rows.forEach(r =>
      console.log(`  ${r.unit_id} ${r.zone}: ${r.cnt} 支 設定為 ${MATERIAL}`)
    );
  } catch (err) {
    console.error('❌ 更新失敗：', err.message);
  } finally {
    await pool.end();
  }
}

main();
