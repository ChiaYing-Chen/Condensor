import React, { useState } from 'react';
import { Upload, FileType, CheckCircle2, AlertCircle, KeyRound, Loader2, X, Info, Download } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { generateTubeMap } from '../utils/tubeMapGenerator';

interface DataImportProps {
  unitId: string;
}

export default function DataImport({ unitId }: DataImportProps) {
  const [importMode, setImportMode] = useState<'before' | 'after'>('before');
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'validation_review' | 'uploading' | 'success' | 'error' | 'password_required'>('idle');
  const [message, setMessage] = useState('');
  const [warningMessage, setWarningMessage] = useState(''); // 非阻斷的警告訊息
  const [duplicateList, setDuplicateList] = useState<any[]>([]);
  const [missingList, setMissingList] = useState<any[]>([]);
  const [password, setPassword] = useState('');
  const [pendingRecords, setPendingRecords] = useState<any[]>([]);
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const [validationSummary, setValidationSummary] = useState<any[]>([]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const uploadRecords = async (records: any[], pass = '') => {
    setStatus('uploading');
    setMessage(`正在上傳 ${records.length} 筆紀錄至伺服器...`);
    
    try {
      const endpoint = importMode === 'before' ? `${import.meta.env.BASE_URL}api/records/upload` : `${import.meta.env.BASE_URL}api/maintenance/upload`;
      const bodyPayload = { records, password: pass, unit_id: unitId };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        if (response.status === 403 && result.requirePassword) {
          setStatus('password_required');
          setMessage(result.error || '需要密碼以覆寫現有年份資料');
          return;
        }
        throw new Error(result.error || 'Server error');
      }
      
      setStatus('success');
      setMessage(`成功匯入！${result.message}`);
      setPendingRecords([]);
      setPassword('');
      setPendingYear(null);
    } catch (err: any) {
      setStatus('error');
      setMessage(`上傳失敗: ${err.message}`);
    }
  };

  const processFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    // 檔名與機組匹配檢查
    const normalizedFilename = file.name.toUpperCase().replace(/[-_]/g, '');
    const normalizedUnitId = unitId.toUpperCase().replace(/[-_]/g, '');
    
    // 如果檔名中完全不包含機組名稱 (例如檔名沒有 TG1，但選擇的機組是 TG-1)
    if (!normalizedFilename.includes(normalizedUnitId)) {
      setStatus('error');
      setMessage(`上傳失敗：檔名「${file.name}」與目前選擇的機組「${unitId}」不匹配，請確認是否上傳錯誤檔案！`);
      return;
    }
    
    if (ext === 'xlsx' || ext === 'xls') {
      // --- Excel 路徑 ---
      setStatus('parsing');
      setMessage('正在解析 Excel 檔案...');
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(e.target?.result, { type: 'array' });
          let allData: any[] = [];
          
          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' }) as any[];
            if (data.length > 0) {
              const firstRow = data[0];
              const keys = Object.keys(firstRow);
              
              // 智慧判斷與補全: 若缺少區域，則把 sheetName 當作區域
              const zoneKey = keys.find(k => k.includes('區域') || k.toLowerCase().includes('zone'));
              if (!zoneKey) {
                data.forEach(row => { row['區域/Zone'] = sheetName; });
              }
              
              // 若缺少機組，則帶入目前選擇的機組
              const unitKey = keys.find(k => k.includes('機組') || k.includes('Unit') || k.includes('unit_id') || k.includes('unit'));
              if (!unitKey) {
                data.forEach(row => { row['機組/Unit'] = unitId; });
              }
              
              allData = allData.concat(data);
            }
          });

          if (allData.length === 0) {
            setStatus('error');
            setMessage('檔案中沒有資料列，請確認工作表不為空白。');
            return;
          }
          validateAndUpload(allData);
        } catch (err: any) {
          setStatus('error');
          setMessage(`解析 Excel 失敗: ${err.message}`);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // --- CSV 路徑 ---
      setStatus('parsing');
      setMessage('正在解析 CSV 檔案...');
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors && results.errors.length > 0) {
            setStatus('error');
            setMessage('資料格式有誤，請確認 CSV 檔案編碼與格式。');
            return;
          }
          const data = results.data as any[];
          if (data.length === 0) {
            setStatus('error');
            setMessage('檔案似乎是空的，找不到任何資料列。');
            return;
          }
          validateAndUpload(data);
        },
        error: (error) => {
          setStatus('error');
          setMessage(`解析失敗: ${error.message}`);
        }
      });
    }
  };

  // 共用驗證與上傳邏輯 (多年份智慧檢查)
  const validateAndUpload = (data: any[]) => {
    // 找出所有 keys
    let allKeys = new Set<string>();
    data.forEach(row => Object.keys(row).forEach(k => allKeys.add(k)));
    const keys = Array.from(allKeys);

    const unitKey = keys.find(k => k.includes('機組') || k.includes('Unit') || k.includes('unit_id') || k.includes('unit'));
    const yearKey = keys.find(k => k.includes('年份') || k.includes('Year') || k.includes('year'));
    let rowKey = keys.find(k => k.toLowerCase().includes('row'));
    if (!rowKey) rowKey = keys.find(k => k.includes('行'));

    let colKey = keys.find(k => k.toLowerCase().includes('col'));
    if (!colKey) colKey = keys.find(k => k.includes('列') && k !== rowKey);

    let zoneKey = keys.find(k => k.toLowerCase().includes('zone'));
    if (!zoneKey) zoneKey = keys.find(k => k.includes('區域'));

    const codeKey = keys.find(k => k.includes('瑕疵') || k.toLowerCase().includes('code'));
    const sizeKey = keys.find(k => k.includes('深度') || k.toLowerCase().includes('size'));
    let notesKey = keys.find(k => k.includes('備註') || k.toLowerCase().includes('notes'));
    if (!notesKey) {
      notesKey = '備註';
    }

    if (!unitKey) { setStatus('error'); setMessage('解析失敗：找不到「機組」欄位。'); return; }
    if (!yearKey) { setStatus('error'); setMessage('解析失敗：找不到「年份」欄位。'); return; }
    if (!rowKey)  { setStatus('error'); setMessage('解析失敗：找不到「行/Row」欄位。'); return; }
    if (!colKey)  { setStatus('error'); setMessage('解析失敗：找不到「列/Col」欄位。'); return; }

    const masterMap = generateTubeMap();
    const expectedTubesCount = masterMap?.length || 6312;
    
    const expectedPerZone = new Map<string, number>();
    if (masterMap && Array.isArray(masterMap)) {
      masterMap.forEach((t: any) => {
        const z = String(t.zone || '').trim();
        expectedPerZone.set(z, (expectedPerZone.get(z) || 0) + 1);
      });
    }

    // 分組依年份
    const yearGroups = new Map<number, any[]>();
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      let rawYear = row[yearKey];
      if (!rawYear && rawYear !== 0) continue;
      
      let y = parseInt(String(rawYear), 10);
      if (isNaN(y)) continue;
      if (y < 1911 && y > 0) y = y + 1911;

      if (!yearGroups.has(y)) yearGroups.set(y, []);
      row._originalIndex = i + 2; 
      yearGroups.get(y)!.push(row);
    }

    if (yearGroups.size === 0) {
      setStatus('error'); setMessage('解析失敗：找不到有效的年份資料。'); return;
    }

    const summaries: any[] = [];
    
    yearGroups.forEach((yearData, year) => {
      const seenRecords = new Map<string, any>();
      const duplicates: any[] = [];
      const zonesCount = new Map<string, number>();
      const seenTubes = new Set<string>(); // Added for missing tubes tracking
      
      const finalYearData: any[] = [];

      yearData.forEach(row => {
        const zone = zoneKey ? String(row[zoneKey] || '').trim() : '';
        const r = String(row[rowKey!] || '').trim();
        const c = String(row[colKey!] || '').trim();
        
        const key = `${zone}-${r}-${c}`;
        seenTubes.add(key);
        
        if (seenRecords.has(key)) {
          const existingRow = seenRecords.get(key);
          const existingCode = codeKey ? String(existingRow[codeKey] || '').trim().toUpperCase() : '';
          const newCode = codeKey ? String(row[codeKey] || '').trim().toUpperCase() : '';
          
          if ((existingCode === 'PIT' && newCode === 'DNT') || (existingCode === 'DNT' && newCode === 'PIT')) {
            if (newCode === 'PIT') {
              if (codeKey) existingRow[codeKey] = row[codeKey];
              if (sizeKey) existingRow[sizeKey] = row[sizeKey];
            }
            // Add note to existingRow, appending if there is already a note
            if (existingRow[notesKey]) {
              existingRow[notesKey] += ' (也檢測到DNT)';
            } else {
              existingRow[notesKey] = '也檢測到DNT';
            }
          } else {
            let isIdentical = true;
            for (const k of keys) {
              const val1 = row[k] === undefined || row[k] === null ? '' : String(row[k]).trim();
              const val2 = existingRow[k] === undefined || existingRow[k] === null ? '' : String(existingRow[k]).trim();
              if (val1 !== val2) {
                isIdentical = false;
                break;
              }
            }
            
            if (!isIdentical) {
              duplicates.push({
                excelRow: row._originalIndex,
                origRow: existingRow._originalIndex,
                zone, row: r, col: c
              });
            }
          }
        } else {
          seenRecords.set(key, row);
          zonesCount.set(zone, (zonesCount.get(zone) || 0) + 1);
          finalYearData.push(row);
        }
      });

      let missingDetails: string[] = [];
      let totalMissing = 0;
      let totalUnexpected = 0;
      
      expectedPerZone.forEach((expectedCount, z) => {
        const actualCount = zonesCount.get(z) || 0;
        if (actualCount !== expectedCount) {
          if (actualCount < expectedCount) {
            totalMissing += (expectedCount - actualCount);
            missingDetails.push(`[${z}] 少 ${expectedCount - actualCount} 筆`);
          } else {
            totalUnexpected += (actualCount - expectedCount);
            missingDetails.push(`[${z}] 多 ${actualCount - expectedCount} 筆`);
          }
        }
      });

      // 檢查是否有上傳了不在標準象限內的區域
      zonesCount.forEach((actualCount, z) => {
        if (!expectedPerZone.has(z)) {
          totalUnexpected += actualCount;
          missingDetails.push(`[${z}] 為未知象限，共 ${actualCount} 筆`);
        }
      });
      
      const missingTubes: any[] = [];
      if (masterMap && Array.isArray(masterMap)) {
         masterMap.forEach((t: any) => {
           const tz = String(t.zone || '').trim();
           const tr = String(t.row || '').trim();
           const tc = String(t.col || '').trim();
           const key = `${tz}-${tr}-${tc}`;
           // 若該管號屬於預期區域，但沒有出現在這年上傳的資料中
           if (expectedPerZone.has(tz) && !seenTubes.has(key)) {
             missingTubes.push({
               "區域/Zone": tz,
               "行/Row": tr,
               "列/Col": tc
             });
           }
         });
      }

      let yearStatus: 'perfect' | 'warning' | 'error' = 'perfect';
      let action: 'upload' | 'skip' | 'abort' = 'upload';
      
      if (duplicates.length > 0 || totalMissing > 0 || totalUnexpected > 0) {
        yearStatus = 'error';
        action = 'skip';
      }

      summaries.push({
        year,
        totalParsed: seenRecords.size,
        missing: totalMissing,
        unexpected: totalUnexpected,
        missingDetails,
        missingTubes,
        duplicates: duplicates.length,
        duplicateDetails: duplicates,
        quadrants: Array.from(zonesCount.keys()),
        status: yearStatus,
        action,
        records: finalYearData
      });
    });

    summaries.sort((a, b) => b.year - a.year);
    setValidationSummary(summaries);
    setStatus('validation_review');
  };

  const confirmValidation = () => {
    const recordsToUpload: any[] = [];
    validationSummary.forEach(s => {
      if (s.action === 'upload') {
        recordsToUpload.push(...s.records);
      }
    });

    if (recordsToUpload.length === 0) {
      setStatus('idle');
      return;
    }

    setPendingRecords(recordsToUpload);
    uploadRecords(recordsToUpload, '');
  };



  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
    // 清除 value，讓使用者可以重複選擇同一個檔案
    e.target.value = '';
  };

  const downloadExample = () => {
    let data;
    let filename;
    if (importMode === 'before') {
      data = [
        {
          "機組/Unit": "TG-1",
          "年份": 112,
          "區域/Zone": "IR",
          "行/Row": 1,
          "列/Col": 13,
          "瑕疵/Code": "PIT",
          "深度/Size": 27.2
        }
      ];
      filename = "檢測結果_Before_匯入範例.xlsx";
    } else {
      data = [
        {
          "機組/Unit": "TG-1",
          "年份": 112,
          "區域/Zone": "IR",
          "行/Row": 1,
          "列/Col": 13,
          "處置/action": "PLG",
          "新材質/new_material": ""
        },
        {
          "機組/Unit": "TG-1",
          "年份": 112,
          "區域/Zone": "OR",
          "行/Row": 4,
          "列/Col": 11,
          "處置/action": "RPL",
          "新材質/new_material": "海軍銅"
        }
      ];
      filename = "大修處置_After_匯入範例.xlsx";
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "範例資料");
    XLSX.writeFile(wb, filename);
  };

  const downloadList = (data: any[], type: string, year: number) => {
    let exportData = data;
    if (type === '重複清單') {
      exportData = data.map(d => ({
        "Excel 行號": d.excelRow,
        "與哪行重複": d.origRow,
        "區域/Zone": d.zone,
        "行/Row": d.row,
        "列/Col": d.col
      }));
    }
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "清單");
    XLSX.writeFile(wb, `${unitId}_${year}年_${type}.xlsx`);
  };

  return (
    <div className="space-y-6 max-w-4xl relative">
      <div>
        <h2 className="text-2xl font-bold text-white">資料匯入與匯出</h2>
        <p className="text-slate-400">目前選擇機組: <span className="text-blue-400 font-bold ml-1">{unitId}</span></p>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => { setImportMode('before'); setStatus('idle'); }}
          className={`px-5 py-3 rounded-lg border-2 font-medium transition-all ${
            importMode === 'before' 
              ? 'bg-blue-900/40 border-blue-500 text-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.2)]'
              : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'
          }`}
        >
          上傳【檢測結果】 (Before)
        </button>
        <button
          onClick={() => { setImportMode('after'); setStatus('idle'); }}
          className={`px-5 py-3 rounded-lg border-2 font-medium transition-all ${
            importMode === 'after' 
              ? 'bg-emerald-900/40 border-emerald-500 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
              : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'
          }`}
        >
          上傳【大修處置】 (After)
        </button>
      </div>

      <div className="bg-slate-900 p-8 rounded-xl shadow-sm border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          {importMode === 'before' ? '📥 匯入檢測原始資料' : '🛠️ 匯入大修處置結果'}
        </h3>
        
        <p className="text-sm text-slate-400 mt-2 mb-6 flex items-center gap-2">
          <Info size={16} className={importMode === 'before' ? 'text-blue-400' : 'text-emerald-400'} />
          {importMode === 'before' 
            ? '這是探傷測試完成後取得的管壁磨損紀錄，將作為「未處斷前 (Before)」的基礎數據。'
            : '這是針對特定管位執行塞管、換管等維修動作的紀錄，將自動更新該管的目前狀態屬性（如材質與管齡）並呈現於「處置後 (After)」視圖。'
          }
        </p>
        
        <div 
          className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
            dragActive ? 'border-blue-500 bg-blue-900/20' : 'border-slate-700 hover:border-slate-600 hover:bg-slate-800/50'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input 
            type="file" 
            accept=".csv,.xlsx,.xls"
            onChange={handleChange} 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            disabled={status === 'parsing' || status === 'uploading'}
          />
          
          <div className="flex flex-col items-center justify-center space-y-4 pointer-events-none">
            <div className={`p-4 rounded-full ${importMode === 'before' ? 'bg-blue-900/50 text-blue-400' : 'bg-emerald-900/50 text-emerald-400'}`}>
              <Upload size={32} />
            </div>
            <div>
              <p className="text-lg font-medium text-slate-300">點擊或拖曳檔案至此</p>
              <p className="text-sm text-slate-400 mt-1">支持 <span className="font-bold text-white">.xlsx</span> / <span className="font-bold text-white">.xls</span> / <span className="font-bold text-white">.csv</span> 格式</p>
              <p className="text-xs text-slate-500 mt-1">
                必須包含欄位：<span className="font-bold text-white">機組</span>（如 TG-1）與 <span className="font-bold text-white">年份</span>，缺一不可。
              </p>
            </div>
          </div>
        </div>

        {status !== 'idle' && status !== 'password_required' && (
          <div className={`mt-6 p-4 rounded-lg flex items-start gap-3 ${
            status === 'parsing' || status === 'uploading' ? 'bg-blue-900/20 text-blue-400 border border-blue-800' :
            status === 'success' ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-800' :
            'bg-red-900/20 text-red-400 border border-red-800'
          }`}>
            {(status === 'parsing' || status === 'uploading') && <Loader2 className="animate-spin text-blue-500 shrink-0" />}
            {status === 'success' && <CheckCircle2 className="text-emerald-500 shrink-0" />}
            {status === 'error' && <AlertCircle className="text-red-500 shrink-0" />}
            <div>
              <p className="font-medium whitespace-pre-line">{message}</p>
              {status === 'success' && (
                <p className="text-sm mt-1 opacity-80">資料已成功寫入資料庫，可前往「動態演變」或「儀表板」查看最新結果。</p>
              )}
            </div>
          </div>
        )}

        {/* 非阻斷警告訊息（例如總支數不足） */}
        {warningMessage && status !== 'idle' && (
          <div className="mt-4 p-4 rounded-lg flex flex-col gap-3 bg-amber-900/20 text-amber-400 border border-amber-700/50">
            <div className="flex items-start gap-3">
              <AlertCircle className="shrink-0 mt-0.5" size={18} />
              <div>
                <p className="font-semibold text-sm">⚠️ 資料品質警告（不影響上傳）</p>
                <p className="text-sm mt-1 whitespace-pre-line text-amber-500/90">{warningMessage}</p>
              </div>
            </div>
            
            {missingList.length > 0 && (
              <div className="mt-2 bg-slate-900/80 rounded-md border border-amber-900/40 overflow-hidden">
                <div className="bg-amber-900/40 px-3 py-1.5 text-xs font-bold text-amber-300">遺失清單列表 (前 100 筆)</div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs text-left text-slate-300">
                    <thead className="sticky top-0 bg-slate-800">
                      <tr>
                        <th className="px-3 py-2 font-medium">區域 (Zone)</th>
                        <th className="px-3 py-2 font-medium">行 (Row)</th>
                        <th className="px-3 py-2 font-medium">列 (Col)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {missingList.slice(0, 100).map((m, i) => (
                        <tr key={i} className="hover:bg-slate-800/50">
                          <td className="px-3 py-1.5">{m.zone}</td>
                          <td className="px-3 py-1.5">{m.row}</td>
                          <td className="px-3 py-1.5">{m.col}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {missingList.length > 100 && (
                     <div className="px-3 py-2 text-center text-xs text-slate-500 italic bg-slate-900/50">
                       ...還有 {missingList.length - 100} 筆未顯示
                     </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* 重複錯誤表格 */}
        {duplicateList.length > 0 && status === 'error' && (
          <div className="mt-4 bg-red-950/20 rounded-lg border border-red-900/50 overflow-hidden">
            <div className="bg-red-900/40 px-4 py-2 text-sm font-bold text-red-300 flex items-center gap-2">
              <X size={16} />
              重複資料列表
            </div>
            <div className="max-h-60 overflow-y-auto">
              <table className="w-full text-sm text-left text-slate-300">
                <thead className="sticky top-0 bg-slate-800 border-b border-red-900/50">
                  <tr>
                    <th className="px-4 py-2 font-medium text-red-300">Excel 行號</th>
                    <th className="px-4 py-2 font-medium text-slate-400">與哪行重複 (Orig)</th>
                    <th className="px-4 py-2 font-medium">區域 (Zone)</th>
                    <th className="px-4 py-2 font-medium">行 (Row)</th>
                    <th className="px-4 py-2 font-medium">列 (Col)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-900/20">
                  {duplicateList.slice(0, 50).map((d, i) => (
                    <tr key={i} className="hover:bg-red-900/10">
                      <td className="px-4 py-2 font-bold text-red-400">第 {d.excelRow} 行</td>
                      <td className="px-4 py-2 text-slate-400">第 {d.origRow} 行</td>
                      <td className="px-4 py-2">{d.zone}</td>
                      <td className="px-4 py-2">{d.row}</td>
                      <td className="px-4 py-2">{d.col}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {duplicateList.length > 50 && (
                  <div className="px-4 py-2 text-center text-xs text-slate-500 italic bg-slate-900">
                    ...還有 {duplicateList.length - 50} 筆未顯示
                  </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-slate-800">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-medium text-slate-200">CSV 必備欄位對應範例</h4>
            <button 
              onClick={downloadExample}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700 transition-colors"
            >
              <Download size={16} />
              下載 Excel 範例
            </button>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-4 overflow-x-auto border border-slate-700">
            {importMode === 'before' ? (
              <table className="w-full text-sm text-left text-slate-400">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="pb-2 font-mono text-orange-300">機組/Unit</th>
                    <th className="pb-2 font-mono text-white">年份</th>
                    <th className="pb-2 font-mono">區域/Zone</th>
                    <th className="pb-2 font-mono">行/Row</th>
                    <th className="pb-2 font-mono">列/Col</th>
                    <th className="pb-2 font-mono text-blue-300">瑕疵/Code</th>
                    <th className="pb-2 font-mono text-blue-300">深度/Size</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-700/50">
                    <td className="py-2 font-mono text-orange-300">TG-1</td>
                    <td className="py-2 font-mono text-slate-300">112</td>
                    <td className="py-2 font-mono text-slate-300">IR</td>
                    <td className="py-2 font-mono text-slate-300">1</td>
                    <td className="py-2 font-mono text-slate-300">13</td>
                    <td className="py-2 font-mono text-slate-300">PIT</td>
                    <td className="py-2 font-mono text-slate-300">27.2</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm text-left text-slate-400">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="pb-2 font-mono text-orange-300">機組/Unit</th>
                    <th className="pb-2 font-mono text-white">年份</th>
                    <th className="pb-2 font-mono">區域/Zone</th>
                    <th className="pb-2 font-mono">行/Row</th>
                    <th className="pb-2 font-mono">列/Col</th>
                    <th className="pb-2 font-mono text-emerald-300">處置/action</th>
                    <th className="pb-2 font-mono text-emerald-300">新材質/new_material</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-700/50">
                    <td className="py-2 font-mono text-orange-300">TG-1</td>
                    <td className="py-2 font-mono text-slate-300">112</td>
                    <td className="py-2 font-mono text-slate-300">IR</td>
                    <td className="py-2 font-mono text-slate-300">1</td>
                    <td className="py-2 font-mono text-slate-300">13</td>
                    <td className="py-2 font-mono text-slate-300">PLG</td>
                    <td className="py-2 font-mono text-slate-500 italic">空值</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="py-2 font-mono text-orange-300">TG-1</td>
                    <td className="py-2 font-mono text-slate-300">112</td>
                    <td className="py-2 font-mono text-slate-300">OR</td>
                    <td className="py-2 font-mono text-slate-300">4</td>
                    <td className="py-2 font-mono text-slate-300">11</td>
                    <td className="py-2 font-mono text-yellow-300">RPL</td>
                    <td className="py-2 font-mono text-yellow-300">海軍銅</td>
                  </tr>
                </tbody>
              </table>
            )}
            <p className="text-xs text-slate-500 mt-4 italic">
              * 中英文標題列皆可辨識。系統會根據第一筆資料判讀該檔案所屬年份。若同時包含多年份，只會以第一行為準。
            </p>
          </div>
        </div>
      </div>

      {/* Password Modal Overlay */}
      {status === 'password_required' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center -m-6 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6 w-[400px] max-w-full">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2 text-yellow-500 font-bold text-lg">
                <AlertCircle size={24} />
                安全驗證 (資料庫覆寫)
              </div>
              <button onClick={() => setStatus('idle')} className="text-slate-500 hover:text-slate-300">
                <X size={20} />
              </button>
            </div>
            
            <p className="text-slate-300 text-sm mb-6 leading-relaxed">
              您上傳的資料包含<span className="text-white font-semibold mx-1">針對該機組年份已存在</span>的紀錄。
              為了防止誤蓋舊資料，系統需要您輸入系統覆寫密碼。
            </p>
            
            <div className="space-y-4">
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="請輸入授權密碼"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 text-white focus:ring-blue-500 focus:border-blue-500 outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') uploadRecords(pendingRecords, password);
                  }}
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-2">
                <button 
                  onClick={() => setStatus('idle')}
                  className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={() => uploadRecords(pendingRecords, password)}
                  className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg transition-colors"
                >
                  確認覆寫
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Validation Review Modal Overlay */}
      {status === 'validation_review' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6 w-[800px] max-w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <div className="flex items-center gap-2 text-white font-bold text-xl">
                <CheckCircle2 className="text-blue-500" size={24} />
                資料完整性檢查報告
              </div>
              <button onClick={() => setStatus('idle')} className="text-slate-500 hover:text-slate-300">
                <X size={24} />
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 pr-2 space-y-4 min-h-0">
              {validationSummary.map((s, idx) => (
                <div key={s.year} className={`p-4 rounded-lg border ${
                  s.status === 'perfect' ? 'bg-slate-800/50 border-slate-700' :
                  s.status === 'warning' ? 'bg-amber-900/10 border-amber-800/50' :
                  'bg-red-900/10 border-red-800/50'
                }`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-lg font-bold text-white flex items-center gap-2">
                        {s.year} 年
                        {s.status === 'perfect' && <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-400 border border-emerald-800">完整正確</span>}
                        {s.status === 'warning' && <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-400 border border-amber-800">資料短少</span>}
                        {s.status === 'error' && <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-red-900/50 text-red-400 border border-red-800">資料異常</span>}
                      </h4>
                      <p className="text-sm text-slate-400 mt-1">
                        涵蓋象限: {s.quadrants.join(', ') || '無'} | 總筆數: {s.totalParsed} 筆
                      </p>
                      
                      {s.status === 'warning' && (
                        <div className="text-sm text-amber-500 mt-2 space-y-1">
                          <div className="flex justify-between items-center">
                            <p className="flex items-center gap-1"><AlertCircle size={14} /> 資料不完整或數量不符：</p>
                            {s.missingTubes && s.missingTubes.length > 0 && (
                              <button
                                onClick={() => downloadList(s.missingTubes, '缺少清單', s.year)}
                                className="flex items-center gap-1 px-2 py-1 bg-amber-900/50 hover:bg-amber-800/50 text-amber-300 rounded border border-amber-800 transition-colors"
                              >
                                <Download size={12} />
                                下載缺少清單
                              </button>
                            )}
                          </div>
                          <ul className="list-disc list-inside pl-1 text-xs">
                            {s.missingDetails.map((detail: string, i: number) => <li key={i}>{detail}</li>)}
                          </ul>
                        </div>
                      )}
                      
                      {s.status === 'error' && (
                        <div className="text-sm text-red-400 mt-2 space-y-1">
                          <p className="flex items-center gap-1"><X size={14} /> 發現異常：</p>
                          {s.duplicates > 0 && (
                            <div className="max-h-24 overflow-y-auto bg-slate-950/50 rounded p-2 text-xs font-mono mb-2">
                              <div className="flex justify-between items-center mb-1">
                                <p className="text-red-300">發現 {s.duplicates} 筆重複資料：</p>
                                <button
                                  onClick={() => downloadList(s.duplicateDetails, '重複清單', s.year)}
                                  className="flex items-center gap-1 px-2 py-1 bg-red-900/50 hover:bg-red-800/50 text-red-300 rounded border border-red-800 transition-colors"
                                >
                                  <Download size={12} />
                                  下載重複清單
                                </button>
                              </div>
                              {s.duplicateDetails.slice(0, 5).map((d: any, i: number) => (
                                <div key={i}>Row {d.excelRow} 與 Row {d.origRow} 重複 ({d.zone}-{d.row}-{d.col})</div>
                              ))}
                              {s.duplicateDetails.length > 5 && <div>...等共 {s.duplicates} 筆</div>}
                            </div>
                          )}
                          {s.missingDetails.length > 0 && (
                            <div className="bg-slate-950/50 rounded p-2 mt-2">
                              <div className="flex justify-between items-center mb-1">
                                <p className="text-red-300">資料遺失細節：</p>
                                {s.missingTubes && s.missingTubes.length > 0 && (
                                  <button
                                    onClick={() => downloadList(s.missingTubes, '缺少清單', s.year)}
                                    className="flex items-center gap-1 px-2 py-1 bg-red-900/50 hover:bg-red-800/50 text-red-300 rounded border border-red-800 transition-colors"
                                  >
                                    <Download size={12} />
                                    下載缺少清單
                                  </button>
                                )}
                              </div>
                              <ul className="list-disc list-inside pl-1 text-xs text-red-300">
                                {s.missingDetails.map((detail: string, i: number) => <li key={i}>{detail}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-col items-end gap-2 ml-4">
                      <label className="text-sm font-medium text-slate-300">處理動作</label>
                      <select 
                        className={`bg-slate-950 border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ${
                          s.action === 'upload' ? 'border-emerald-700 text-emerald-400 focus:ring-emerald-500' : 'border-slate-700 text-slate-400 focus:ring-slate-500'
                        }`}
                        value={s.action}
                        onChange={(e) => {
                          const newSummary = [...validationSummary];
                          newSummary[idx].action = e.target.value as any;
                          setValidationSummary(newSummary);
                        }}
                      >
                        {s.status !== 'error' && <option value="upload">上傳此年份</option>}
                        <option value="skip">忽略此年份 (不上傳)</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-800 shrink-0">
              <p className="text-sm text-slate-400">
                將上傳 <span className="text-white font-bold">{validationSummary.filter(s => s.action === 'upload').length}</span> 個年份的資料
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setStatus('idle')}
                  className="px-5 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  全部取消
                </button>
                <button 
                  onClick={confirmValidation}
                  disabled={validationSummary.filter(s => s.action === 'upload').length === 0}
                  className="px-5 py-2.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-medium shadow-lg transition-colors flex items-center gap-2"
                >
                  <Upload size={16} />
                  確認並上傳
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

