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

async function checkTG4() {
  try {
    const res = await pool.query(`
      SELECT year, SUM(CASE WHEN code='PLG' THEN 1 ELSE 0 END) as inspect_plg, count(*) as total_records
      FROM inspection_records 
      WHERE unit_id='TG-4' 
      GROUP BY year ORDER BY year DESC
    `);
    console.log("=== Inspection Records for TG-4 ===");
    console.table(res.rows);

    const res2 = await pool.query(`
      SELECT year, action, count(*) 
      FROM maintenance_actions 
      WHERE unit_id='TG-4' 
      GROUP BY year, action ORDER BY year DESC
    `);
    console.log("=== Maintenance Actions for TG-4 ===");
    console.table(res2.rows);

    // Get max_plugged using the exact query from server.js
    const maxQuery = await pool.query(`
      WITH maint_years AS (
        SELECT DISTINCT year FROM maintenance_actions WHERE unit_id = $1
      ),
      raw_data AS (
        SELECT 
          i.year,
          i.code as inspect_code,
          i.size_val,
          m.action as maint_action
        FROM inspection_records i
        LEFT JOIN maintenance_actions m 
          ON i.unit_id = m.unit_id AND i.year = m.year 
          AND i.zone = m.zone AND i.row_num = m.row_num AND i.col_num = m.col_num
        WHERE i.unit_id = $1
      ),
      yearly_summary AS (
        SELECT r.year,
          SUM(CASE WHEN inspect_code = 'PLG' THEN 1 ELSE 0 END) as before_plugged,
          SUM(CASE 
            WHEN my.year IS NOT NULL THEN
               CASE 
                 WHEN maint_action IN ('PLG', '塞管') THEN 1
                 WHEN maint_action IN ('RPL', '換管') THEN 0
                 WHEN inspect_code = 'PLG' THEN 1
                 ELSE 0
               END
            ELSE
               CASE
                 WHEN inspect_code = 'PLG' THEN 1
                 WHEN size_val > 50 THEN 1
                 WHEN inspect_code = 'COR' THEN 1
                 ELSE 0
               END
          END) as after_plugged
        FROM raw_data r
        LEFT JOIN maint_years my ON r.year = my.year
        GROUP BY r.year
      )
      SELECT year, before_plugged, after_plugged FROM yearly_summary ORDER BY year DESC;
    `, ['TG-4']);
    console.log("=== Yearly Summary from /api/max_plugged logic ===");
    console.table(maxQuery.rows);

  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

checkTG4();
