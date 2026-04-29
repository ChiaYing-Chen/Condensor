import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function main() {
  const uid = 'TG-1';
  const yearsRes = await pool.query('SELECT DISTINCT year FROM inspection_records WHERE unit_id = $1 ORDER BY year DESC', [uid]);
  const years = yearsRes.rows.map(r => r.year);
  
  let maxPlugged = 0;

  for (const year of years) {
    const recordsRes = await pool.query('SELECT * FROM inspection_records WHERE unit_id = $1 AND year = $2', [uid, year]);
    const maintRes = await pool.query('SELECT * FROM maintenance_actions WHERE unit_id = $1 AND year = $2', [uid, year]);
    
    const records = recordsRes.rows;
    const maint = maintRes.rows;
    
    const hasMaintenance = maint.length > 0;
    
    let beforePlugged = 0;
    let afterPlugged = 0;
    
    records.forEach(r => {
      // Before logic
      let isPluggedBefore = r.code === 'PLG';
      if (isPluggedBefore) beforePlugged++;
      
      // After logic
      let isPluggedAfter = r.code === 'PLG';
      let depth = Number(r.size_val) || 0;
      let code = r.code || 'NDD';
      
      let action = null;
      if (hasMaintenance) {
        action = maint.find(m => m.zone === r.zone && m.row_num === r.row_num && m.col_num === r.col_num);
      }
      
      if (action) {
        if (action.action === 'PLG' || action.action === '塞管') isPluggedAfter = true;
        else if (action.action === 'RPL' || action.action === '換管') isPluggedAfter = false;
      } else if (!hasMaintenance) {
        if (depth > 50) isPluggedAfter = true;
        if (code === 'COR') isPluggedAfter = true;
      }
      
      if (isPluggedAfter) afterPlugged++;
    });
    
    console.log(`Year ${year}: before=${beforePlugged}, after=${afterPlugged}`);
    maxPlugged = Math.max(maxPlugged, beforePlugged, afterPlugged);
  }
  
  console.log(`Calculated Max Plugged: ${maxPlugged}`);
  process.exit(0);
}

main().catch(console.error);
