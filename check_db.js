import dotenv from 'dotenv';
import pg from 'pg';
const { Pool } = pg;

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function checkNotes() {
  try {
    const res = await pool.query(`
      SELECT unit_id, year, zone, row_num, col_num, code, size_val, notes 
      FROM inspection_records 
      WHERE notes IS NOT NULL
      ORDER BY year DESC
      LIMIT 10;
    `);
    console.log("🔍 最近 10 筆有備註的資料：");
    console.table(res.rows);

    const res2 = await pool.query(`
      SELECT unit_id, year, zone, row_num, col_num, code, size_val, notes 
      FROM inspection_records 
      WHERE row_num = 10 AND col_num = 31 AND zone = 'IR'
      ORDER BY year DESC;
    `);
    console.log("\n🔍 IR/10/31 管位的資料：");
    console.table(res2.rows);

  } catch (err) {
    console.error("查詢錯誤:", err);
  } finally {
    await pool.end();
  }
}

checkNotes();
