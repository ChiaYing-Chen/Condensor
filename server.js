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
const port = process.env.PORT || 3006;
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

const pimcpPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.PIMCP_DB_NAME || 'PIMCP',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});
pimcpPool.on('error', (err) => {
  console.error('⚠️  PIMCP PostgreSQL Pool Error (non-fatal):', err.message);
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

// --- Restart Service (觸發 NSSM 自動重啟) ---
app.post('/api/restart', async (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== OVERWRITE_PASSWORD) {
    return res.status(403).json({ error: '密碼錯誤，無法重啟服務' });
  }
  res.json({ success: true, message: '服務重啟指令已收到，將於 1 秒後由常駐程序重新啟動...' });
  setTimeout(() => {
    console.log('🔄 收到管理者重啟指令，程序正在退出以觸發 NSSM 重啟...');
    process.exit(0);
  }, 1000);
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

const mergeNoteStrings = (oldNote, newNote) => {
  const parts = [];
  const addParts = (str) => {
    if (!str || typeof str !== 'string') return;
    str.split(/;\s*/).map(s => s.trim()).filter(Boolean).forEach(p => {
      if (!parts.includes(p)) parts.push(p);
    });
  };
  addParts(oldNote);
  addParts(newNote);
  return parts.join('; ');
};

// 上傳檢測紀錄（覆寫需密碼）
app.post('/api/records/upload', async (req, res) => {
  const { password, records, unit_id, material_updates, fileName, file_name, uploaded_by } = req.body;
  const notesMode = req.body?.notes_mode === 'overwrite' ? 'overwrite' : 'merge';
  const uid = unit_id || 'TG-1';
  const uploadFileName = fileName || file_name || `${uid}_檢測原始資料.xlsx`;
  const uploader = uploaded_by || '系統使用者';

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
        const notesCheck = await pool.query(
          `SELECT COUNT(*)::int AS cnt FROM inspection_records
           WHERE unit_id = $1 AND year = ANY($2::int[]) AND notes IS NOT NULL AND BTRIM(notes) <> ''`,
          [uid, targetYears]
        );
        const existingNotesCount = notesCheck.rows[0]?.cnt || 0;
        return res.status(403).json({
          error: '部分年份的資料已存在，覆寫需要密碼',
          requirePassword: true,
          existingNotesCount
        });
      }
    }
    await pool.query('BEGIN');

    const existingNotesMap = new Map();
    if (exists && notesMode === 'merge') {
      const oldNotesRes = await pool.query(
        `SELECT year, zone, row_num, col_num, notes FROM inspection_records
         WHERE unit_id = $1 AND year = ANY($2::int[]) AND notes IS NOT NULL AND BTRIM(notes) <> ''`,
        [uid, targetYears]
      );
      oldNotesRes.rows.forEach(r => {
        existingNotesMap.set(`${r.year}-${String(r.zone).trim().toUpperCase()}-${r.row_num}-${r.col_num}`, r.notes);
      });
    }

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

    // 後端合併同一管位的多 Channel 紀錄
    // 規則一：PLG + 任何檢測結果 (PIT/DNT/NDD) → 資料異常，跳過整個管位
    // 規則二：同管位 Code 相同 → 保留深度 (size_val) 最大的那一筆
    // 規則三：同管位 DNT + PIT → 保留 PIT，DNT 加入備註
    const mergedMap = new Map();
    let skippedNoYear = 0;
    let skippedNoLocation = 0;
    let skippedInvalid = 0;
    let successCount = 0;

    for (const row of records) {
      const keys2 = Object.keys(row);
      const yearK2 = keys2.find(k => k.includes('年份') || k.toLowerCase().includes('year'));
      const rawYear2 = yearK2 ? row[yearK2] : (row['年份'] || row['Year'] || row['year']);
      const ty = normalizeYear(rawYear2);
      if (!ty) {
        skippedNoYear++;
        continue;
      }

      const zk2 = keys2.find(k => k.includes('區域') || k.toLowerCase().includes('zone'));
      const rk2 = keys2.find(k => k.includes('行') || k.toLowerCase().includes('row'));
      const ck2 = keys2.find(k => k.includes('列') || k.toLowerCase().includes('col'));
      const chk2 = keys2.find(k => k.includes('頻道') || k.toLowerCase().includes('channel'));
      const codeK2 = keys2.find(k => k.includes('瑕疵') || k.toLowerCase().includes('code'));
      const sizeK2 = keys2.find(k => k.includes('深度') || k.toLowerCase().includes('size'));

      const z2 = (zk2 ? String(row[zk2]) : '').trim().toUpperCase();
      const r2 = parseInt(rk2 ? String(row[rk2]) : '', 10);
      const c2 = parseInt(ck2 ? String(row[ck2]) : '', 10);
      const ch2 = chk2 ? String(row[chk2] || '').trim() : '';
      const code2 = codeK2 ? String(row[codeK2] || '').trim().toUpperCase() : '';
      const size2 = sizeK2 ? parseFloat(row[sizeK2]) || 0 : 0;

      if (!z2 || isNaN(r2) || isNaN(c2)) {
        skippedNoLocation++;
        continue;
      }

      const dedupKey = `${ty}-${z2}-${r2}-${c2}`;

      if (!mergedMap.has(dedupKey)) {
        mergedMap.set(dedupKey, {
          row: { ...row },
          codes: new Set([code2]),
          maxSize: size2,
          dntNotes: [],
          invalid: false,
          invalidReason: ''
        });
      } else {
        const entry = mergedMap.get(dedupKey);
        entry.codes.add(code2);

        // 規則一：PLG 與任何檢測結果並存 → 資料矛盾
        const hasPLG = entry.codes.has('PLG');
        const hasInspection = entry.codes.has('PIT') || entry.codes.has('DNT') || entry.codes.has('NDD');
        if (hasPLG && hasInspection) {
          entry.invalid = true;
          entry.invalidReason = `${z2}-${r2}-${c2}: PLG 與 ${[...entry.codes].filter(c => c !== 'PLG').join('/')} 並存，資料矛盾`;
          console.error(`[INVALID] ${entry.invalidReason}`);
          skippedInvalid++;
          continue;
        }

        // 取得目前主紀錄的 code
        const mainCodeKey = Object.keys(entry.row).find(k => k.includes('瑕疵') || k.toLowerCase().includes('code'));
        const mainCode = mainCodeKey ? String(entry.row[mainCodeKey] || '').trim().toUpperCase() : '';

        // 規則三：DNT + PIT → PIT 為主，DNT 入備註
        if ((code2 === 'DNT' && mainCode === 'PIT') || (code2 === 'PIT' && mainCode === 'DNT')) {
          if (code2 === 'PIT') {
            // 新的是 PIT，替換主紀錄
            const savedDntNotes = entry.dntNotes;
            entry.row = { ...row };
            entry.maxSize = size2;
            entry.dntNotes = savedDntNotes;
          }
          // DNT 加入備註
          entry.dntNotes.push(ch2 ? `DNT(${ch2})` : 'DNT');
          console.warn(`[MERGE] DNT+PIT 合併: ${dedupKey}`);
          continue;
        }

        // 規則二：同 Code → 保留深度最大的那一筆
        if (code2 === mainCode) {
          if (size2 > entry.maxSize) {
            entry.row = { ...row };
            entry.maxSize = size2;
          }
          continue;
        }

        // 其他 Code 組合（NDD 與 PIT 等）：以深度決定
        if (size2 > entry.maxSize) {
          entry.row = { ...row };
          entry.maxSize = size2;
        }
      }
    }

    const inspectionWrittenList = [];

    // 寫入合併後的結果
    for (const [, entry] of mergedMap.entries()) {
      if (entry.invalid) {
        console.error(`[SKIP] 跳過資料異常管位: ${entry.invalidReason}`);
        continue;
      }

      const row = entry.row;
      const keys = Object.keys(row);
      const zoneKey = keys.find(k => k.includes('區域') || k.toLowerCase().includes('zone'));
      const rowKey  = keys.find(k => k.includes('行') || k.toLowerCase().includes('row'));
      const colKey  = keys.find(k => k.includes('列') || k.toLowerCase().includes('col'));
      const channelKey = keys.find(k => k.includes('頻道') || k.toLowerCase().includes('channel'));
      const codeKey = keys.find(k => k.includes('瑕疵') || k.toLowerCase().includes('code'));
      const sizeKey = keys.find(k => k.includes('深度') || k.toLowerCase().includes('size'));
      const notesKey = keys.find(k => k.includes('備註') || k.toLowerCase().includes('notes'));
      const yearKey = keys.find(k => k.includes('年份') || k.toLowerCase().includes('year'));

      const rawYear = yearKey ? row[yearKey] : (row['年份'] || row['Year'] || row['year']);
      const targetYear = normalizeYear(rawYear);
      if (!targetYear) continue;

      const zone = zoneKey ? row[zoneKey] : null;
      const row_num = rowKey ? row[rowKey] : null;
      const col_num = colKey ? row[colKey] : null;
      const channel = channelKey ? row[channelKey] : null;
      const code = codeKey ? row[codeKey] : 'NDD';
      const size_val = sizeKey ? row[sizeKey] : 0;

      // 組合備註：原備註 + DNT 附記
      const baseNotes = notesKey ? (row[notesKey] || '') : '';
      const finalNotes = entry.dntNotes.length > 0
        ? (baseNotes ? `${baseNotes}; 也檢測到${entry.dntNotes.join(',')}` : `也檢測到${entry.dntNotes.join(',')}`)
        : baseNotes;

      if (zone && row_num && col_num) {
        const zUpper = String(zone).trim().toUpperCase();
        const rInt = parseInt(row_num, 10);
        const cInt = parseInt(col_num, 10);
        const chStr = channel ? String(channel).trim() : null;
        const cUpper = code ? String(code).trim().toUpperCase() : 'NDD';
        const sVal = parseFloat(size_val) || 0;
        const noteKey = `${targetYear}-${zUpper}-${rInt}-${cInt}`;
        const prevNote = existingNotesMap.get(noteKey) || '';
        const mergedNote = (exists && notesMode === 'merge' && prevNote)
          ? mergeNoteStrings(prevNote, String(finalNotes || ''))
          : finalNotes;
        const nStr = mergedNote || null;

        await pool.query(insertQuery, [
          uid,
          targetYear,
          zUpper,
          rInt,
          cInt,
          chStr,
          cUpper,
          sVal,
          nStr
        ]);
        successCount++;
        inspectionWrittenList.push({
          year: targetYear,
          zone: zUpper,
          row_num: rInt,
          col_num: cInt,
          channel: chStr,
          code: cUpper,
          size_val: sVal,
          notes: nStr
        });
      }
    }

    // 處理材質更新
    if (material_updates && Array.isArray(material_updates) && material_updates.length > 0) {
      for (const update of material_updates) {
        if (update.zone && !isNaN(update.row_num) && !isNaN(update.col_num) && update.material) {
          await pool.query(
            `INSERT INTO tube_registry (unit_id, zone, row_num, col_num, material, status)
             VALUES ($1, $2, $3, $4, $5, 'active')
             ON CONFLICT (unit_id, zone, row_num, col_num) 
             DO UPDATE SET material = $5, updated_at = NOW()`,
            [uid, update.zone.trim(), parseInt(update.row_num, 10), parseInt(update.col_num, 10), update.material.trim()]
          );
        }
      }
    }

    // 寫入檢測上傳歷史與快照 (upload_history)
    for (const y of targetYears) {
      const yearRows = inspectionWrittenList.filter(r => r.year === y);
      if (yearRows.length > 0) {
        const codeSummary = {};
        yearRows.forEach(r => {
          const c = r.code || 'NDD';
          codeSummary[c] = (codeSummary[c] || 0) + 1;
        });
        await pool.query(
          `INSERT INTO upload_history (unit_id, data_type, year, file_name, record_count, action_summary, records_snapshot, is_overwrite, uploaded_by, created_at)
           VALUES ($1, 'inspection', $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [uid, y, uploadFileName, yearRows.length, JSON.stringify(codeSummary), JSON.stringify(yearRows), exists, uploader]
        );
      }
    }

    await pool.query('COMMIT');
    res.json({ 
      success: true, 
      message: `共處理 ${records.length} 筆資料。成功寫入 ${successCount} 筆。\n(跳過: 無年份=${skippedNoYear}, 無管位=${skippedNoLocation}, 資料矛盾=${skippedInvalid}, 經合併=${records.length - successCount - skippedNoYear - skippedNoLocation - skippedInvalid})`,
      successCount
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const syncUploadHistoryRecord = async (uid, dataType, targetYear, zoneUpper, rNum, cNum, patchFields, defaultRow) => {
  const histRes = await pool.query(
    `SELECT id, records_snapshot FROM upload_history
     WHERE unit_id = $1 AND data_type = $2 AND year = $3
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [uid, dataType, targetYear]
  );
  if (histRes.rows.length > 0 && Array.isArray(histRes.rows[0].records_snapshot)) {
    const snapshot = [...histRes.rows[0].records_snapshot];
    const idx = snapshot.findIndex(
      r => String(r.zone).trim().toUpperCase() === zoneUpper &&
           Number(r.row_num) === rNum &&
           Number(r.col_num) === cNum
    );
    if (idx >= 0) {
      snapshot[idx] = { ...snapshot[idx], ...patchFields };
    } else if (defaultRow) {
      snapshot.push(defaultRow);
    }
    const summary = {};
    snapshot.forEach(r => {
      const key = dataType === 'maintenance' ? (r.action || 'PLG') : (r.code || 'NDD');
      summary[key] = (summary[key] || 0) + 1;
    });
    await pool.query(
      'UPDATE upload_history SET records_snapshot = $1, record_count = $2, action_summary = $3 WHERE id = $4',
      [JSON.stringify(snapshot), snapshot.length, JSON.stringify(summary), histRes.rows[0].id]
    );
  }
};

const checkCondensorAdmin = async (userInput) => {
  const raw = String(userInput || '').trim();
  if (!raw || raw === '匿名' || raw.toLowerCase() === 'guest') {
    return { isAdmin: false, userId: '', userName: raw || '匿名' };
  }
  const shortId = raw.split('\\').pop().trim();
  try {
    const res = await pimcpPool.query(
      `SELECT u.user_id, u.name
       FROM app_admin_permissions p
       JOIN org_users u ON LOWER(u.user_id) = LOWER(p.user_id)
       WHERE LOWER(p.app_id) = 'condensor'
         AND (LOWER(p.user_id) = LOWER($1) OR LOWER(u.user_id) = LOWER($1) OR u.name = $1 OR u.name = $2)
       LIMIT 1`,
      [shortId, raw]
    );
    if (res.rows.length > 0) {
      return {
        isAdmin: true,
        userId: String(res.rows[0].user_id),
        userName: String(res.rows[0].name),
      };
    }
    const userRes = await pimcpPool.query(
      `SELECT user_id, name FROM org_users WHERE LOWER(user_id) = LOWER($1) OR name = $1 OR name = $2 LIMIT 1`,
      [shortId, raw]
    );
    if (userRes.rows.length > 0) {
      return {
        isAdmin: false,
        userId: String(userRes.rows[0].user_id),
        userName: String(userRes.rows[0].name),
      };
    }
  } catch (err) {
    console.error('checkCondensorAdmin DB error:', err.message);
    try {
      const pimcpPort = process.env.PIMCP_PORT || 3011;
      const apiRes = await fetch(
        `http://127.0.0.1:${pimcpPort}/api/app-permissions/condensor/${encodeURIComponent(shortId)}`,
        { headers: { 'x-remote-user': shortId } }
      );
      if (apiRes.ok) {
        const apiJson = await apiRes.json();
        return {
          isAdmin: Boolean(apiJson?.data?.isAdmin),
          userId: String(apiJson?.data?.userId || shortId),
          userName: raw,
        };
      }
    } catch (apiErr) {
      console.error('checkCondensorAdmin HTTP fallback error:', apiErr.message);
    }
  }
  return { isAdmin: false, userId: shortId, userName: raw };
};

// 查詢使用者是否為 Condensor 專案管理人員（來源為 PIMCP app_admin_permissions）
app.get('/api/permissions/check', async (req, res) => {
  const candidate = req.query.user || req.query.clientUser || '';
  const info = await checkCondensorAdmin(candidate);
  res.json({ success: true, ...info });
});

// --- Notes & Single-Tube Inspection Revision (單支管備註與管理人員複檢修改) ---
app.post('/api/notes', async (req, res) => {
  const {
    unit_id,
    year,
    zone,
    row_num,
    col_num,
    before_notes,
    after_notes,
    code,
    size_val,
    operator,
    confirm_inspection_change,
  } = req.body || {};
  const uid = unit_id || 'TG-1';
  const targetYear = parseInt(year, 10);
  const rNum = parseInt(row_num, 10);
  const cNum = parseInt(col_num, 10);
  const zoneStr = typeof zone === 'string' ? zone.trim() : '';

  if (!zoneStr || Number.isNaN(targetYear) || Number.isNaN(rNum) || Number.isNaN(cNum)) {
    return res.status(400).json({ error: '缺少有效的管束座標或年份參數' });
  }
  if (before_notes === undefined && after_notes === undefined && code === undefined && size_val === undefined) {
    return res.status(400).json({ error: '未提供要更新的內容' });
  }

  const zoneUpper = zoneStr.toUpperCase();
  let savedCode;
  let savedSizeVal;
  let savedBeforeNotes = before_notes !== undefined ? (typeof before_notes === 'string' ? before_notes.trim() : '') : undefined;

  try {
    await pool.query('BEGIN');

    if (before_notes !== undefined || code !== undefined || size_val !== undefined) {
      const existingInspRes = await pool.query(
        `SELECT code, size_val, notes FROM inspection_records
         WHERE unit_id = $1 AND year = $2 AND UPPER(BTRIM(zone)) = $3 AND row_num = $4 AND col_num = $5
         LIMIT 1`,
        [uid, targetYear, zoneUpper, rNum, cNum]
      );
      const oldInsp = existingInspRes.rows[0] || { code: 'NDD', size_val: 0, notes: null };
      const oldCode = String(oldInsp.code || 'NDD').trim().toUpperCase();
      const oldSize = Number(oldInsp.size_val) || 0;
      const nextCode = code !== undefined ? String(code).trim().toUpperCase() : oldCode;
      const nextSize = size_val !== undefined ? Number(size_val) : oldSize;

      if (size_val !== undefined && (Number.isNaN(nextSize) || nextSize < 0 || nextSize > 100)) {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: '瑕疵深度必須介於 0 ~ 100% 之間' });
      }

      const isValueModified =
        (code !== undefined && nextCode !== oldCode) ||
        (size_val !== undefined && Math.abs(nextSize - oldSize) > 0.001);

      let noteText = before_notes !== undefined
        ? (typeof before_notes === 'string' ? before_notes.trim() : '')
        : (oldInsp.notes ? String(oldInsp.notes).trim() : '');

      if (isValueModified) {
        const authInfo = await checkCondensorAdmin(operator || req.query.clientUser);
        if (!authInfo.isAdmin) {
          await pool.query('ROLLBACK');
          return res.status(403).json({ error: '權限不足：僅 Condensor 專案管理人員可修改檢測瑕疵碼與深度' });
        }
        if (!confirm_inspection_change) {
          await pool.query('ROLLBACK');
          return res.status(400).json({ error: '請先確認檢測數值變更內容後再送出' });
        }
        const auditTag = `[複檢修正(${authInfo.userName}): 原 ${oldCode} ${oldSize.toFixed(1)}% → ${nextCode} ${nextSize.toFixed(1)}%]`;
        noteText = mergeNoteStrings(noteText, auditTag);
      }

      const dbNote = noteText || null;
      savedCode = nextCode;
      savedSizeVal = nextSize;
      savedBeforeNotes = noteText;

      const updateRes = await pool.query(
        `UPDATE inspection_records
         SET code = $1, size_val = $2, notes = $3
         WHERE unit_id = $4 AND year = $5 AND UPPER(BTRIM(zone)) = $6 AND row_num = $7 AND col_num = $8`,
        [nextCode, nextSize, dbNote, uid, targetYear, zoneUpper, rNum, cNum]
      );
      if (updateRes.rowCount === 0 && (dbNote !== null || isValueModified)) {
        await pool.query(
          `INSERT INTO inspection_records (unit_id, year, zone, row_num, col_num, code, size_val, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [uid, targetYear, zoneUpper, rNum, cNum, nextCode, nextSize, dbNote]
        );
      }
      await syncUploadHistoryRecord(
        uid,
        'inspection',
        targetYear,
        zoneUpper,
        rNum,
        cNum,
        { code: nextCode, size_val: nextSize, notes: dbNote },
        dbNote !== null || isValueModified
          ? {
              year: targetYear,
              zone: zoneUpper,
              row_num: rNum,
              col_num: cNum,
              channel: null,
              code: nextCode,
              size_val: nextSize,
              notes: dbNote,
            }
          : null
      );
    }

    if (after_notes !== undefined) {
      const noteText = typeof after_notes === 'string' ? after_notes.trim() : '';
      const dbNote = noteText || null;
      const updateRes = await pool.query(
        `UPDATE maintenance_actions
         SET notes = $1
         WHERE unit_id = $2 AND year = $3 AND UPPER(BTRIM(zone)) = $4 AND row_num = $5 AND col_num = $6`,
        [dbNote, uid, targetYear, zoneUpper, rNum, cNum]
      );
      if (updateRes.rowCount === 0 && dbNote !== null) {
        // 僅當該年份已有處置紀錄時才補寫 KEP，避免讓尚未大修的年份被判定為已有處置
        const yearCheck = await pool.query(
          'SELECT 1 FROM maintenance_actions WHERE unit_id = $1 AND year = $2 LIMIT 1',
          [uid, targetYear]
        );
        if (yearCheck.rowCount === 0) {
          await pool.query('ROLLBACK');
          return res.status(400).json({ error: `${targetYear} 年尚無大修處置紀錄，無法新增處置後備註` });
        }
        await pool.query(
          `INSERT INTO maintenance_actions (unit_id, year, zone, row_num, col_num, action, notes)
           VALUES ($1, $2, $3, $4, $5, 'KEP', $6)`,
          [uid, targetYear, zoneUpper, rNum, cNum, dbNote]
        );
      }
      await syncUploadHistoryRecord(
        uid,
        'maintenance',
        targetYear,
        zoneUpper,
        rNum,
        cNum,
        { notes: dbNote },
        dbNote !== null
          ? {
              year: targetYear,
              zone: zoneUpper,
              row_num: rNum,
              col_num: cNum,
              action: 'KEP',
              new_material: null,
              notes: dbNote,
            }
          : null
      );
    }

    await pool.query('COMMIT');
    res.json({
      success: true,
      code: savedCode,
      size_val: savedSizeVal,
      before_notes: savedBeforeNotes,
      after_notes: after_notes !== undefined ? (typeof after_notes === 'string' ? after_notes.trim() : '') : undefined,
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Update Note Error:', error);
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
  const { password, records, unit_id, fileName, file_name, uploaded_by } = req.body;
  const notesMode = req.body?.notes_mode === 'overwrite' ? 'overwrite' : 'merge';
  const uid = unit_id || 'TG-1';
  const uploadFileName = fileName || file_name || `${uid}_大修處置結果.xlsx`;
  const uploader = uploaded_by || '系統使用者';

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
        const notesCheck = await pool.query(
          `SELECT COUNT(*)::int AS cnt FROM maintenance_actions
           WHERE unit_id = $1 AND year = ANY($2::int[]) AND notes IS NOT NULL AND BTRIM(notes) <> ''`,
          [uid, targetYears]
        );
        const existingNotesCount = notesCheck.rows[0]?.cnt || 0;
        return res.status(403).json({
          error: '部分年份的處置資料已存在，覆寫需要密碼',
          requirePassword: true,
          existingNotesCount
        });
      }
    }

    await pool.query('BEGIN');

    const existingMaintNotesMap = new Map();
    if (exists && notesMode === 'merge') {
      const oldNotesRes = await pool.query(
        `SELECT year, zone, row_num, col_num, action, notes FROM maintenance_actions
         WHERE unit_id = $1 AND year = ANY($2::int[]) AND notes IS NOT NULL AND BTRIM(notes) <> ''`,
        [uid, targetYears]
      );
      oldNotesRes.rows.forEach(r => {
        existingMaintNotesMap.set(`${r.year}-${String(r.zone).trim().toUpperCase()}-${r.row_num}-${r.col_num}`, r);
      });
    }

    if (exists) {
      await pool.query(
        'DELETE FROM maintenance_actions WHERE unit_id = $1 AND year = ANY($2::int[])',
        [uid, targetYears]
      );
    }

    let insertedCount = 0;
    const insertedRowsList = [];

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
      const rawNotes = notesKey ? row[notesKey] : null;

      if (zone && !isNaN(row_num) && !isNaN(col_num) && action) {
        let act = action.trim().toUpperCase();
        if (act === '換管') act = 'RPL';
        if (act === '塞管') act = 'PLG';

        const zTrim = zone.trim();
        const noteKey = `${targetYear}-${zTrim.toUpperCase()}-${row_num}-${col_num}`;
        let finalNotes = rawNotes ? String(rawNotes).trim() : '';
        if (exists && notesMode === 'merge' && existingMaintNotesMap.has(noteKey)) {
          const oldEntry = existingMaintNotesMap.get(noteKey);
          finalNotes = mergeNoteStrings(oldEntry.notes, finalNotes);
          existingMaintNotesMap.delete(noteKey);
        }
        const notes = finalNotes || null;

        await pool.query(
          `INSERT INTO maintenance_actions (unit_id, year, zone, row_num, col_num, action, new_material, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [uid, targetYear, zTrim, row_num, col_num, act, new_material, notes]
        );
        insertedCount++;
        insertedRowsList.push({
          year: targetYear,
          zone: zTrim,
          row_num,
          col_num,
          action: act,
          new_material,
          notes
        });

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

    if (insertedCount === 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: '沒有任何有效的處置紀錄被寫入，請確認欄位包含「處置/action」且資料不為空白。' });
    }

    // 合併保留原本不在本次上傳清單中的手動備註（如正常管 KEP 備註）
    if (exists && notesMode === 'merge' && existingMaintNotesMap.size > 0) {
      for (const rem of existingMaintNotesMap.values()) {
        const remZone = String(rem.zone).trim();
        await pool.query(
          `INSERT INTO maintenance_actions (unit_id, year, zone, row_num, col_num, action, new_material, notes)
           VALUES ($1, $2, $3, $4, $5, 'KEP', NULL, $6)`,
          [uid, rem.year, remZone, rem.row_num, rem.col_num, rem.notes]
        );
        insertedRowsList.push({
          year: rem.year,
          zone: remZone,
          row_num: rem.row_num,
          col_num: rem.col_num,
          action: 'KEP',
          new_material: null,
          notes: rem.notes
        });
      }
    }

    // 寫入處置上傳歷史與快照 (upload_history)
    for (const y of targetYears) {
      const yearRows = insertedRowsList.filter(r => r.year === y);
      if (yearRows.length > 0) {
        const actionSummary = {};
        yearRows.forEach(r => {
          const a = r.action || 'PLG';
          actionSummary[a] = (actionSummary[a] || 0) + 1;
        });
        await pool.query(
          `INSERT INTO upload_history (unit_id, data_type, year, file_name, record_count, action_summary, records_snapshot, is_overwrite, uploaded_by, created_at)
           VALUES ($1, 'maintenance', $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [uid, y, uploadFileName, yearRows.length, JSON.stringify(actionSummary), JSON.stringify(yearRows), exists, uploader]
        );
      }
    }

    await pool.query('COMMIT');
    res.json({ success: true, message: `成功儲存 ${uid} 共 ${targetYears.length} 個年份、${insertedCount} 筆處置結果 (${targetYears.join(', ')})` });

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
    let successCount = 0;

    for (const t of tubes) {
      await pool.query(
        `INSERT INTO tube_registry (unit_id, zone, row_num, col_num, material, install_year, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (unit_id, zone, row_num, col_num) 
         DO UPDATE SET material = $5, install_year = $6, status = $7, updated_at = NOW()`,
        [uid, t.zone, t.row_num, t.col_num, t.material || '黃銅', t.install_year || null, t.status || 'active']
      );
      successCount++;
    }

    await pool.query('COMMIT');
    res.json({ 
      message: `共處理 ${tubes.length} 筆資料。成功寫入 ${successCount} 筆。`, 
      successCount 
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Tube Init Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Upload History (上傳歷史與快照查詢) ---

// 查詢上傳歷史列表（排除龐大的 records_snapshot）
app.get('/api/upload_history', async (req, res) => {
  const { unit_id, data_type, year, limit } = req.query;
  const maxLimit = Math.min(parseInt(limit, 10) || 100, 300);

  try {
    const conditions = [];
    const params = [];

    if (unit_id) {
      params.push(unit_id);
      conditions.push(`unit_id = $${params.length}`);
    }
    if (data_type) {
      params.push(data_type);
      conditions.push(`data_type = $${params.length}`);
    }
    if (year) {
      params.push(parseInt(year, 10));
      conditions.push(`year = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(maxLimit);

    const queryStr = `
      SELECT id, unit_id, data_type, year, file_name, record_count, action_summary, is_overwrite, uploaded_by, created_at
      FROM upload_history
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}
    `;

    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 查詢單次上傳的完整明細快照
app.get('/api/upload_history/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM upload_history WHERE id = $1',
      [parseInt(id, 10)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到該筆上傳紀錄' });
    }
    res.json(result.rows[0]);
  } catch (error) {
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

// ================================================================
//  自動確保 upload_history 資料表存在與歷史資料回填 (Backfill)
// ================================================================
const ensureUploadHistoryTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS upload_history (
        id SERIAL PRIMARY KEY,
        unit_id VARCHAR(20) NOT NULL REFERENCES units(unit_id),
        data_type VARCHAR(50) NOT NULL,              -- 'maintenance' / 'inspection'
        year INT NOT NULL,
        file_name VARCHAR(255),
        record_count INT DEFAULT 0,
        action_summary JSONB,                        -- 處置/瑕疵統計
        records_snapshot JSONB,                      -- 原始資料快照清單
        is_overwrite BOOLEAN DEFAULT FALSE,          -- 是否為覆寫上傳
        uploaded_by VARCHAR(100) DEFAULT '系統使用者',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_upload_history_unit_type ON upload_history(unit_id, data_type, year);
    `);
    console.log('✅ upload_history table ensured.');

    // 歷史大修處置資料回填 (Backfill)
    const existingMaint = await pool.query(`
      SELECT unit_id, year, COUNT(*) as cnt, MIN(created_at) as first_created
      FROM maintenance_actions
      GROUP BY unit_id, year
    `);

    for (const row of existingMaint.rows) {
      const histCheck = await pool.query(
        'SELECT id FROM upload_history WHERE unit_id = $1 AND data_type = $2 AND year = $3 LIMIT 1',
        [row.unit_id, 'maintenance', row.year]
      );
      if (histCheck.rows.length === 0) {
        const rowsRes = await pool.query(
          'SELECT zone, row_num, col_num, action, new_material, notes FROM maintenance_actions WHERE unit_id = $1 AND year = $2 ORDER BY zone, row_num, col_num',
          [row.unit_id, row.year]
        );
        const summary = {};
        rowsRes.rows.forEach(r => {
          const act = r.action || 'PLG';
          summary[act] = (summary[act] || 0) + 1;
        });
        await pool.query(
          `INSERT INTO upload_history (unit_id, data_type, year, file_name, record_count, action_summary, records_snapshot, is_overwrite, uploaded_by, created_at)
           VALUES ($1, 'maintenance', $2, '系統既有大修處置資料', $3, $4, $5, FALSE, '系統初始化', $6)`,
          [row.unit_id, row.year, rowsRes.rows.length, JSON.stringify(summary), JSON.stringify(rowsRes.rows), row.first_created || new Date()]
        );
        console.log(`📦 Backfilled maintenance history for ${row.unit_id} ${row.year} (${rowsRes.rows.length} rows)`);
      }
    }

    // 歷史檢測結果資料回填 (Backfill)
    const existingInspect = await pool.query(`
      SELECT unit_id, year, COUNT(*) as cnt, MIN(created_at) as first_created
      FROM inspection_records
      GROUP BY unit_id, year
    `);

    for (const row of existingInspect.rows) {
      const histCheck = await pool.query(
        'SELECT id FROM upload_history WHERE unit_id = $1 AND data_type = $2 AND year = $3 LIMIT 1',
        [row.unit_id, 'inspection', row.year]
      );
      if (histCheck.rows.length === 0) {
        const rowsRes = await pool.query(
          'SELECT zone, row_num, col_num, channel, code, size_val, notes FROM inspection_records WHERE unit_id = $1 AND year = $2 ORDER BY zone, row_num, col_num',
          [row.unit_id, row.year]
        );
        const summary = {};
        rowsRes.rows.forEach(r => {
          const c = r.code || 'NDD';
          summary[c] = (summary[c] || 0) + 1;
        });
        await pool.query(
          `INSERT INTO upload_history (unit_id, data_type, year, file_name, record_count, action_summary, records_snapshot, is_overwrite, uploaded_by, created_at)
           VALUES ($1, 'inspection', $2, '系統既有檢測結果資料', $3, $4, $5, FALSE, '系統初始化', $6)`,
          [row.unit_id, row.year, rowsRes.rows.length, JSON.stringify(summary), JSON.stringify(rowsRes.rows), row.first_created || new Date()]
        );
        console.log(`📦 Backfilled inspection history for ${row.unit_id} ${row.year} (${rowsRes.rows.length} rows)`);
      }
    }
  } catch (err) {
    console.error('⚠️  Failed to ensure upload_history table / backfill:', err.message);
  }
};

// Start Server
app.listen(port, async () => {
  console.log(`Condensor Backend Server running on http://localhost:${port}`);
  await ensureDecisionProfilesTable();
  await ensureUploadHistoryTable();
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
