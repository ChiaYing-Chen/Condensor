import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3004;
const OVERWRITE_PASSWORD = process.env.OVERWRITE_PASSWORD || 'W521';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Database connection
const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Utility to normalize year (民國 → 西元)
const normalizeYear = (yearStr) => {
  const y = parseInt(yearStr, 10);
  if (isNaN(y)) return null;
  if (y < 1911 && y > 0) {
    return y + 1911;
  }
  return y;
};

// ================================================================
//  API Endpoints
// ================================================================

// --- Health Check ---
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', message: 'Database connection is healthy' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Database disconnected' });
  }
});

// --- Units ---
app.get('/api/units', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM units ORDER BY unit_id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Tubes Registry ---
app.get('/api/tubes', async (req, res) => {
  const { unit_id } = req.query;
  const uid = unit_id || 'TG-1';
  try {
    const result = await pool.query('SELECT * FROM tube_registry WHERE unit_id = $1', [uid]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Settings ---
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM system_settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  const { password, settings } = req.body;
  if (!password || password !== OVERWRITE_PASSWORD) {
    return res.status(403).json({ error: '密碼錯誤，無法修改設定' });
  }
  try {
    for (const [key, value] of Object.entries(settings)) {
      await pool.query(
        'INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        [key, JSON.stringify(value)]
      );
    }
    res.json({ success: true, message: '設定已更新' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Decision Profiles (處置篩選腳本) ---
app.get('/api/profiles', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM decision_profiles ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profiles', async (req, res) => {
  const { name, remark, rules } = req.body;
  if (!name || !rules) {
    return res.status(400).json({ error: 'Missing name or rules' });
  }
  try {
    await pool.query(
      'INSERT INTO decision_profiles (name, remark, rules) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET remark = $2, rules = $3, created_at = CURRENT_TIMESTAMP',
      [name, remark || '', JSON.stringify(rules)]
    );
    res.json({ success: true, message: 'Profile saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/profiles/:name', async (req, res) => {
  const { name } = req.params;
  try {
    await pool.query('DELETE FROM decision_profiles WHERE name = $1', [name]);
    res.json({ success: true, message: 'Profile deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Inspection Records (檢測結果 / Before) ---

// 取得特定機組的可用年份
app.get('/api/years', async (req, res) => {
  const unit_id = req.query.unit_id || 'TG-1';
  try {
    const result = await pool.query(
      'SELECT DISTINCT year FROM inspection_records WHERE unit_id = $1 ORDER BY year DESC',
      [unit_id]
    );
    res.json(result.rows.map(r => r.year));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/max_plugged', async (req, res) => {
  const unit_id = req.query.unit_id || 'TG-1';
  try {
    const result = await pool.query(`
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
      SELECT GREATEST(COALESCE(MAX(before_plugged), 0), COALESCE(MAX(after_plugged), 0)) as max_plugged FROM yearly_summary;
    `, [unit_id]);
    res.json({ max_plugged: parseInt(result.rows[0]?.max_plugged || 0, 10) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 取得特定機組的可用維護紀錄年份
app.get('/api/maintenance/years', async (req, res) => {
  const unit_id = req.query.unit_id || 'TG-1';
  try {
    const result = await pool.query(
      'SELECT DISTINCT year FROM maintenance_actions WHERE unit_id = $1 ORDER BY year DESC',
      [unit_id]
    );
    res.json(result.rows.map(r => r.year));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 取得特定機組、特定年份的檢測紀錄
app.get('/api/records', async (req, res) => {
  const { year, unit_id } = req.query;
  const uid = unit_id || 'TG-1';
  if (!year) {
    return res.status(400).json({ error: 'Missing year parameter' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM inspection_records WHERE unit_id = $1 AND year = $2',
      [uid, parseInt(year, 10)]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 上傳檢測紀錄（覆寫需密碼）
app.post('/api/records/upload', async (req, res) => {
  const { password, records, unit_id } = req.body;
  const uid = unit_id || 'TG-1';

  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'No records provided' });
  }

  // 從資料中提取所有涵蓋的年份
  const targetYearsSet = new Set();
  for (const r of records) {
    const rawYear = r['年份'] || r['Year'] || r['year'];
    if (rawYear !== undefined && rawYear !== null && rawYear !== '') {
      const yNorm = normalizeYear(rawYear);
      if (yNorm) targetYearsSet.add(yNorm);
    }
  }

  const targetYears = Array.from(targetYearsSet);
  if (targetYears.length === 0) {
    return res.status(400).json({ error: 'Unable to parse year from records' });
  }

  try {
    // 檢查此年份是否已有資料
    const checkResult = await pool.query(
      'SELECT DISTINCT year FROM inspection_records WHERE unit_id = $1 AND year = ANY($2::int[])',
      [uid, targetYears]
    );
    const exists = checkResult.rows.length > 0;

    if (exists) {
      if (!password || password !== OVERWRITE_PASSWORD) {
        return res.status(403).json({ error: '部分年份的資料已存在，覆寫需要密碼', requirePassword: true });
      }
    }

    await pool.query('BEGIN');

    if (exists) {
      await pool.query(
        'DELETE FROM inspection_records WHERE unit_id = $1 AND year = ANY($2::int[])',
        [uid, targetYears]
      );
    }

    const insertQuery = `
      INSERT INTO inspection_records (unit_id, year, zone, row_num, col_num, channel, code, size_val, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    for (const row of records) {
      const rawYear = row['年份'] || row['Year'] || row['year'];
      const targetYear = normalizeYear(rawYear);
      if (!targetYear) continue;

      const keys = Object.keys(row);
      const zoneKey = keys.find(k => k.includes('區域') || k.toLowerCase().includes('zone'));
      const rowKey  = keys.find(k => k.includes('行') || k.toLowerCase().includes('row'));
      const colKey  = keys.find(k => k.includes('列') || k.toLowerCase().includes('col'));
      const channelKey = keys.find(k => k.includes('頻道') || k.toLowerCase().includes('channel'));
      const codeKey = keys.find(k => k.includes('瑕疵') || k.toLowerCase().includes('code'));
      const sizeKey = keys.find(k => k.includes('深度') || k.toLowerCase().includes('size'));
      const notesKey = keys.find(k => k.includes('備註') || k.toLowerCase().includes('notes'));

      const zone = zoneKey ? row[zoneKey] : null;
      const row_num = rowKey ? row[rowKey] : null;
      const col_num = colKey ? row[colKey] : null;
      const channel = channelKey ? row[channelKey] : null;
      const code = codeKey ? row[codeKey] : 'NDD';
      const size_val = sizeKey ? row[sizeKey] : 0;
      const notes = notesKey ? row[notesKey] : null;

      if (zone && row_num && col_num) {
        await pool.query(insertQuery, [
          uid,
          targetYear,
          zone.trim(),
          parseInt(row_num, 10),
          parseInt(col_num, 10),
          channel ? channel.trim() : null,
          code ? code.trim() : 'NDD',
          parseFloat(size_val) || 0,
          notes ? notes.trim() : null
        ]);
      }
    }

    await pool.query('COMMIT');
    res.json({ success: true, message: `成功儲存 ${uid} 共 ${targetYears.length} 個年份的資料 (${targetYears.join(', ')})` });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Maintenance Actions (處置結果 / After) ---

// 取得特定機組、特定年份的處置紀錄
app.get('/api/maintenance', async (req, res) => {
  const { year, unit_id } = req.query;
  const uid = unit_id || 'TG-1';
  if (!year) {
    return res.status(400).json({ error: 'Missing year parameter' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM maintenance_actions WHERE unit_id = $1 AND year = $2',
      [uid, parseInt(year, 10)]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 上傳處置紀錄（覆寫需密碼）
app.post('/api/maintenance/upload', async (req, res) => {
  const { password, records, unit_id } = req.body;
  const uid = unit_id || 'TG-1';

  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'No records provided' });
  }

  // 從資料中提取所有涵蓋的年份
  const targetYearsSet = new Set();
  for (const r of records) {
    const rawYear = r['年份'] || r['Year'] || r['year'];
    if (rawYear !== undefined && rawYear !== null && rawYear !== '') {
      const yNorm = normalizeYear(rawYear);
      if (yNorm) targetYearsSet.add(yNorm);
    }
  }

  const targetYears = Array.from(targetYearsSet);
  if (targetYears.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid year in records' });
  }

  try {
    const checkResult = await pool.query(
      'SELECT DISTINCT year FROM maintenance_actions WHERE unit_id = $1 AND year = ANY($2::int[])',
      [uid, targetYears]
    );
    const exists = checkResult.rows.length > 0;

    if (exists) {
      if (!password || password !== OVERWRITE_PASSWORD) {
        return res.status(403).json({ error: '部分年份的處置資料已存在，覆寫需要密碼', requirePassword: true });
      }
    }

    await pool.query('BEGIN');

    if (exists) {
      await pool.query(
        'DELETE FROM maintenance_actions WHERE unit_id = $1 AND year = ANY($2::int[])',
        [uid, targetYears]
      );
    }

    for (const row of records) {
      const rawYear = row['年份'] || row['Year'] || row['year'];
      const targetYear = normalizeYear(rawYear);
      if (!targetYear) continue;

      const keys = Object.keys(row);
      const zoneKey = keys.find(k => k.includes('區域') || k.toLowerCase().includes('zone'));
      const rowKey  = keys.find(k => k.includes('行') || k.toLowerCase().includes('row'));
      const colKey  = keys.find(k => k.includes('列') || k.toLowerCase().includes('col'));
      const actionKey = keys.find(k => k.includes('處置') || k.toLowerCase().includes('action'));
      const materialKey = keys.find(k => k.includes('材質') || k.toLowerCase().includes('material'));
      const notesKey = keys.find(k => k.includes('備註') || k.toLowerCase().includes('notes'));

      const zone = zoneKey ? row[zoneKey] : null;
      const row_num = rowKey ? parseInt(row[rowKey], 10) : NaN;
      const col_num = colKey ? parseInt(row[colKey], 10) : NaN;
      const action = actionKey ? row[actionKey] : null;
      const new_material = materialKey ? row[materialKey] : null;
      const notes = notesKey ? row[notesKey] : null;

      if (zone && !isNaN(row_num) && !isNaN(col_num) && action) {
        let act = action.trim().toUpperCase();
        if (act === '換管') act = 'RPL';
        if (act === '塞管') act = 'PLG';

        await pool.query(
          `INSERT INTO maintenance_actions (unit_id, year, zone, row_num, col_num, action, new_material, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [uid, targetYear, zone.trim(), row_num, col_num, act, new_material, notes]
        );

        // 如果是換管 (RPL)，更新 tube_registry 的材質與安裝年份
        if (act === 'RPL') {
          if (new_material) {
            await pool.query(
              `UPDATE tube_registry 
               SET material = $1, install_year = $2, status = 'active', updated_at = NOW()
               WHERE unit_id = $3 AND zone = $4 AND row_num = $5 AND col_num = $6`,
              [new_material.trim(), targetYear, uid, zone.trim(), row_num, col_num]
            );
          } else {
            await pool.query(
              `UPDATE tube_registry 
               SET install_year = $1, status = 'active', updated_at = NOW()
               WHERE unit_id = $2 AND zone = $3 AND row_num = $4 AND col_num = $5`,
              [targetYear, uid, zone.trim(), row_num, col_num]
            );
          }
        }

        // 如果是塞管 (PLG)，更新 tube_registry 狀態
        if (act === 'PLG') {
          await pool.query(
            `UPDATE tube_registry 
             SET status = 'plugged', updated_at = NOW()
             WHERE unit_id = $1 AND zone = $2 AND row_num = $3 AND col_num = $4`,
            [uid, zone.trim(), row_num, col_num]
          );
        }
      }
    }

    await pool.query('COMMIT');
    res.json({ success: true, message: `成功儲存 ${uid} 共 ${targetYears.length} 個年份的處置結果 (${targetYears.join(', ')})` });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Maintenance Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Tube Registry (管齡 / 材質查詢) ---

// 取得某機組所有管的目前狀態（含材質、管齡）
app.get('/api/tubes', async (req, res) => {
  const uid = req.query.unit_id || 'TG-1';
  try {
    const result = await pool.query(
      `SELECT *, 
              (EXTRACT(YEAR FROM NOW()) - install_year) AS tube_age
       FROM tube_registry 
       WHERE unit_id = $1 
       ORDER BY zone, row_num, col_num`,
      [uid]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批次初始化管登錄資料（首次建立時需要）
app.post('/api/tubes/init', async (req, res) => {
  const { password, unit_id, tubes } = req.body;
  const uid = unit_id || 'TG-1';

  if (!password || password !== OVERWRITE_PASSWORD) {
    return res.status(403).json({ error: '此操作需要密碼' });
  }
  if (!tubes || !Array.isArray(tubes) || tubes.length === 0) {
    return res.status(400).json({ error: 'No tube data provided' });
  }

  try {
    await pool.query('BEGIN');

    for (const t of tubes) {
      await pool.query(
        `INSERT INTO tube_registry (unit_id, zone, row_num, col_num, material, install_year, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (unit_id, zone, row_num, col_num) 
         DO UPDATE SET material = $5, install_year = $6, status = $7, updated_at = NOW()`,
        [uid, t.zone, t.row_num, t.col_num, t.material || '黃銅', t.install_year || null, t.status || 'active']
      );
    }

    await pool.query('COMMIT');
    res.json({ success: true, message: `成功初始化 ${uid} 共 ${tubes.length} 筆管登錄資料` });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Tube Init Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Static Files (Production) ---
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ================================================================
//  自動確保 decision_profiles 資料表存在（補丁：若 init_db.js 未執行此表）
// ================================================================
const ensureDecisionProfilesTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS decision_profiles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        remark TEXT DEFAULT '',
        rules JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ decision_profiles table ensured.');
  } catch (err) {
    console.error('⚠️  Failed to ensure decision_profiles table:', err.message);
  }
};

// Start Server
app.listen(port, async () => {
  console.log(`Condensor Backend Server running on http://localhost:${port}`);
  await ensureDecisionProfilesTable();
});

// ================================================================
//  全域錯誤處理：防止 DB 連線失敗導致伺服器崩潰
// ================================================================

// pg Pool 連線錯誤 (idle client error)
pool.on('error', (err) => {
  console.error('⚠️  PostgreSQL Pool Error (non-fatal):', err.message);
  console.error('   伺服器將繼續運行，但資料庫功能暫時不可用。');
  // 不 process.exit()，讓伺服器繼續服務前端靜態頁面
});

// 未捕獲的 Promise rejection（例如首次連線 timeout）
process.on('unhandledRejection', (reason, promise) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  // 只記錄 DB 相關錯誤，不讓伺服器崩潰
  if (msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED') || msg.includes('password authentication')) {
    console.error('⚠️  資料庫連線失敗 (non-fatal):', msg);
    console.error('   前端頁面仍可正常存取，資料功能待 DB 連線後恢復。');
  } else {
    console.error('⚠️  Unhandled Promise Rejection:', promise, 'Reason:', reason);
  }
});

// 未捕獲的同步例外（最後防線）
process.on('uncaughtException', (err) => {
  const msg = err.message || '';
  if (msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED') || msg.includes('password authentication')) {
    console.error('⚠️  資料庫連線例外 (non-fatal):', msg);
  } else {
    console.error('❌  Uncaught Exception (fatal):', err);
    process.exit(1); // 只在非 DB 的嚴重錯誤時才退出
  }
});
