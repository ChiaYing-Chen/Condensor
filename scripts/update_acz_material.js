/**
 * update_acz_material.js
 *
 * 功能：
 *  Step 1 - 將 tubeMap.json 的全部管子批次初始化到 tube_registry（已存在略過）
 *  Step 2 - 將 ACZ 範圍的管子材質更新為「銅鎳(C71500)」
 *
 * 執行：
 *  node scripts/update_acz_material.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const require = createRequire(import.meta.url);
const tubeMap = require('../src/utils/tubeMap.json'); // 全部 6312 支的佈局

const { Pool } = pg;
const pool = new Pool({
  user:     process.env.DB_USER,
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port:     process.env.DB_PORT,
});

// ─── ACZ 邊界（row → 最大含 col）─────────────────────────────────
const ACZ_BOUNDARY = {
  1: 9,  2: 9,  3: 10, 4: 10, 5: 11, 6: 11, 7: 12, 8: 12,
  9: 13, 10: 13, 11: 14, 12: 14, 13: 15, 14: 15, 15: 16, 16: 16,
  17: 17, 18: 17, 19: 18, 20: 18, 21: 19, 22: 19, 23: 20,
  24: 19, 25: 19, 26: 18, 27: 18, 28: 17,
};

const UNITS    = ['TG-1', 'TG-2', 'TG-3', 'TG-4'];
const ZONES    = ['IL', 'IR'];
const MATERIAL = '銅鎳(C71500)';

/** 判斷是否屬於 ACZ 範圍 */
function isACZ(zone, row, col) {
  if (!ZONES.includes(zone)) return false;
  const maxCol = ACZ_BOUNDARY[row];
  return maxCol !== undefined && col <= maxCol;
}

/** 分批執行，避免超過 pg 參數上限 */
async function batchInsert(client, rows, batchSize = 2000) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    await client.query(`
      INSERT INTO tube_registry (unit_id, zone, row_num, col_num, material, status)
      SELECT
        unnest($1::text[]),
        unnest($2::text[]),
        unnest($3::int[]),
        unnest($4::int[]),
        unnest($5::text[]),
        'active'
      ON CONFLICT (unit_id, zone, row_num, col_num) DO NOTHING
    `, [
      chunk.map(r => r.unit_id),
      chunk.map(r => r.zone),
      chunk.map(r => r.row_num),
      chunk.map(r => r.col_num),
      chunk.map(r => r.material),
    ]);
    inserted += chunk.length;
    process.stdout.write(`\r  已處理 ${inserted}/${rows.length} 筆...`);
  }
  console.log('');
  return inserted;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ══════════════════════════════════════════════════════════════
    // Step 1：初始化 tube_registry
    // ══════════════════════════════════════════════════════════════
    console.log('\n====== Step 1：初始化 tube_registry ======');
    const rows = [];
    for (const unit of UNITS) {
      for (const tube of tubeMap) {
        rows.push({
          unit_id: unit,
          zone:    tube.zone,
          row_num: tube.row,
          col_num: tube.col,
          material: isACZ(tube.zone, tube.row, tube.col) ? MATERIAL : '黃銅',
        });
      }
    }
    console.log(`準備插入 ${rows.length} 筆（${UNITS.length} 機 × ${tubeMap.length} 支）`);
    await batchInsert(client, rows);

    // ══════════════════════════════════════════════════════════════
    // Step 2：強制更新 ACZ 範圍材質（處理已存在但材質未設定的舊資料）
    // ══════════════════════════════════════════════════════════════
    console.log('\n====== Step 2：更新 ACZ 材質 ======');

    // 產生 (row_num, col_num) IN (...) 條件（純整數，安全）
    const tupleParts = [];
    for (const [rowStr, maxCol] of Object.entries(ACZ_BOUNDARY)) {
      const row = parseInt(rowStr);
      for (let col = 1; col <= maxCol; col++) {
        tupleParts.push(`(${row},${col})`);
      }
    }
    const tupleStr = tupleParts.join(',');

    const updateRes = await client.query(`
      UPDATE tube_registry
      SET material = $1, updated_at = NOW()
      WHERE unit_id = ANY($2::text[])
        AND zone    = ANY($3::text[])
        AND (row_num, col_num) IN (${tupleStr})
    `, [MATERIAL, UNITS, ZONES]);

    console.log(`✅ ACZ 材質更新完成，實際更新筆數：${updateRes.rowCount}`);

    await client.query('COMMIT');

    // ── 驗證 ──
    const verifyRes = await client.query(`
      SELECT unit_id, zone, COUNT(*) AS cnt
      FROM tube_registry
      WHERE material = $1
        AND unit_id = ANY($2::text[])
      GROUP BY unit_id, zone
      ORDER BY unit_id, zone
    `, [MATERIAL, UNITS]);

    console.log('\n── 驗證結果 ──');
    verifyRes.rows.forEach(r =>
      console.log(`  ${r.unit_id} ${r.zone}: ${r.cnt} 支 → ${MATERIAL}`)
    );

    const totalACZ = Object.values(ACZ_BOUNDARY).reduce((s, c) => s + c, 0);
    console.log(`\n預期每機組 IL+IR 各 ${totalACZ} 支，共 ${totalACZ * 2} 支/機組`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ 發生錯誤，已 ROLLBACK：', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
