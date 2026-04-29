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

async function initDB() {
  try {
    console.log('Connecting to database...');

    // ============================================================
    // 1. units - 機組基本資料
    // ============================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS units (
        unit_id VARCHAR(20) PRIMARY KEY,            -- 'TG-1', 'TG-2', 'TG-3', 'TG-4'
        name VARCHAR(100) NOT NULL,                  -- '一號機冷凝器'
        total_tubes INT DEFAULT 6312,                -- 總管數
        commission_year INT,                         -- 建廠年份（西元）
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ `units` table ready.');

    // ============================================================
    // 2. tube_registry - 每支管的「目前狀態」（材質、管齡、塞管狀態）
    //    換管時更新 material + install_year
    // ============================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tube_registry (
        id SERIAL PRIMARY KEY,
        unit_id VARCHAR(20) NOT NULL REFERENCES units(unit_id),
        zone VARCHAR(10) NOT NULL,                   -- 'IR', 'IL', 'OR', 'OL'
        row_num INT NOT NULL,
        col_num INT NOT NULL,
        material VARCHAR(50) DEFAULT '黃銅',          -- '黃銅' / '海軍銅' / 其他
        install_year INT,                            -- 安裝年份（西元），用於計算管齡
        status VARCHAR(20) DEFAULT 'active',         -- 'active' / 'plugged'
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(unit_id, zone, row_num, col_num)      -- 每台機組的每支管只有一筆
      );
    `);
    console.log('✅ `tube_registry` table ready.');

    // ============================================================
    // 3. inspection_records - 每年檢測結果（Before 圖的資料來源）
    //    對應 CSV 匯入的原始探傷報表
    // ============================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inspection_records (
        id SERIAL PRIMARY KEY,
        unit_id VARCHAR(20) NOT NULL REFERENCES units(unit_id),
        year INT NOT NULL,                           -- 西元年
        zone VARCHAR(10),                            -- 'IR', 'IL', 'OR', 'OL'
        row_num INT,
        col_num INT,
        channel VARCHAR(50),                         -- 頻道
        code VARCHAR(50),                            -- 瑕疵碼: PIT, NDD, COR, PLG, BLK...
        size_val FLOAT DEFAULT 0,                    -- 深度 %
        notes TEXT,                                  -- 備註
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(unit_id, year, zone, row_num, col_num)
      );
    `);
    
    // 確保如果表已存在，補上 notes 欄位
    try {
      await pool.query('ALTER TABLE inspection_records ADD COLUMN IF NOT EXISTS notes TEXT;');
    } catch (e) {
      console.log('Column notes might already exist.');
    }
    console.log('✅ `inspection_records` table ready.');

    // ============================================================
    // 4. maintenance_actions - 當次大修處置結果（After 圖的資料來源）
    //    記錄每支管在該年度大修中的處置動作
    // ============================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS maintenance_actions (
        id SERIAL PRIMARY KEY,
        unit_id VARCHAR(20) NOT NULL REFERENCES units(unit_id),
        year INT NOT NULL,                           -- 大修年份（西元）
        zone VARCHAR(10),
        row_num INT,
        col_num INT,
        action VARCHAR(20) NOT NULL,                 -- 'PLG'=塞管, 'RPL'=換管, 'KEP'=保留, 'CLN'=清洗
        new_material VARCHAR(50),                    -- 換管時填寫新材質，其他動作可為 NULL
        notes TEXT,                                  -- 附註
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(unit_id, year, zone, row_num, col_num)
      );
    `);
    console.log('✅ `maintenance_actions` table ready.');

    // ============================================================
    // 5. system_settings - 系統設定（塞管條件、警示條件等）
    // ============================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(50) PRIMARY KEY,
        value JSONB,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ `system_settings` table ready.');

    // ============================================================
    // 6. decision_profiles - 處置篩選公式腳本（共用儲存）
    // ============================================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS decision_profiles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,           -- 腳本名稱（唯一鍵）
        remark TEXT DEFAULT '',                       -- 備註說明
        rules JSONB NOT NULL,                        -- 公式陣列 [{id, formula, enabled}]
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ `decision_profiles` table ready.');

    // ============================================================
    // 預設資料
    // ============================================================

    // 預設 4 部機組
    const defaultUnits = [
      { unit_id: 'TG-1', name: 'TG-1 冷凝器', total_tubes: 6312 },
      { unit_id: 'TG-2', name: 'TG-2 冷凝器', total_tubes: 6312 },
      { unit_id: 'TG-3', name: 'TG-3 冷凝器', total_tubes: 6312 },
      { unit_id: 'TG-4', name: 'TG-4 冷凝器', total_tubes: 6312 },
    ];

    for (const u of defaultUnits) {
      await pool.query(`
        INSERT INTO units (unit_id, name, total_tubes)
        VALUES ($1, $2, $3)
        ON CONFLICT (unit_id) DO NOTHING;
      `, [u.unit_id, u.name, u.total_tubes]);
    }
    console.log('✅ Default units inserted.');

    // 預設系統設定
    const defaultSettings = [
      {
        key: 'plugging_conditions',
        value: JSON.stringify({
          condition_1_growth: 30,
          condition_1_depth: 40,
          condition_2_growth: 35,
          condition_3_depth: 50,
          condition_4_code: 'COR'
        })
      },
      {
        key: 'warning_conditions',
        value: JSON.stringify({
          condition_A_total_ratio: 40,
          condition_B_prev: ['PLG', 'RST'],
          condition_C_prev: 'RST',
          condition_C_curr: 'RST'
        })
      }
    ];

    for (const setting of defaultSettings) {
      await pool.query(`
        INSERT INTO system_settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO NOTHING;
      `, [setting.key, setting.value]);
    }
    console.log('✅ Default settings inserted.');

    console.log('\n🎉 Database initialization completed successfully!');
    
  } catch (err) {
    console.error('❌ Error initializing database:', err);
  } finally {
    await pool.end();
  }
}

initDB();
