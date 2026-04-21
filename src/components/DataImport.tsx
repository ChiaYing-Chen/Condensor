import React, { useState } from 'react';
import { Upload, FileType, CheckCircle2, AlertCircle, KeyRound, Loader2, X, Info } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { generateTubeMap } from '../utils/tubeMapGenerator';

interface DataImportProps {
  unitId: string;
}

export default function DataImport({ unitId }: DataImportProps) {
  const [importMode, setImportMode] = useState<'before' | 'after'>('before');
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'uploading' | 'success' | 'error' | 'password_required'>('idle');
  const [message, setMessage] = useState('');
  const [warningMessage, setWarningMessage] = useState(''); // 非阻斷的警告訊息
  const [duplicateList, setDuplicateList] = useState<any[]>([]);
  const [missingList, setMissingList] = useState<any[]>([]);
  const [password, setPassword] = useState('');
  const [pendingRecords, setPendingRecords] = useState<any[]>([]);
  const [pendingYear, setPendingYear] = useState<number | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const uploadRecords = async (records: any[], year: number, pass = '') => {
    setStatus('uploading');
    setMessage(`正在上傳 ${records.length} 筆紀錄至伺服器...`);
    
    try {
      const endpoint = importMode === 'before' ? `${import.meta.env.BASE_URL}api/records/upload` : `${import.meta.env.BASE_URL}api/maintenance/upload`;
      const bodyPayload = importMode === 'before' 
        ? { records, password: pass, unit_id: unitId }
        : { records, password: pass, unit_id: unitId, year }; // for after, we might explicitly pass year if we want, but server.js also checks year in body. let's pass it.

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
    
    if (ext === 'xlsx' || ext === 'xls') {
      // --- Excel 路徑 ---
      setStatus('parsing');
      setMessage('正在解析 Excel 檔案...');
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(e.target?.result, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' }) as any[];
          if (data.length === 0) {
            setStatus('error');
            setMessage('檔案中沒有資料列，請確認工作表不為空白。');
            return;
          }
          validateAndUpload(data);
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

  // 共用驗證與上傳邏輯
  const validateAndUpload = (data: any[]) => {
    const firstRow = data[0];
    const keys = Object.keys(firstRow);
    setWarningMessage(''); // 清除舊警告

    const unitKey = keys.find(k => k.includes('機組') || k.includes('Unit') || k.includes('unit_id') || k.includes('unit'));
    const yearKey = keys.find(k => k.includes('年份') || k.includes('Year') || k.includes('year'));
    const rowKey  = keys.find(k => k.includes('行') || k.toLowerCase().includes('row'));
    const colKey  = keys.find(k => k.includes('列') || k.toLowerCase().includes('col'));
    const zoneKey = keys.find(k => k.includes('區域') || k.toLowerCase().includes('zone'));

    if (!unitKey) { setStatus('error'); setMessage('解析失敗：找不到「機組」欄位。請確認標題包含「機組」或「Unit」。'); return; }
    if (!yearKey) { setStatus('error'); setMessage('解析失敗：找不到「年份」欄位。請確認標題包含「年份」或「Year」。'); return; }
    if (!rowKey)  { setStatus('error'); setMessage('解析失敗：找不到「行」欄位。請確認標題包含「行」或「Row」。'); return; }
    if (!colKey)  { setStatus('error'); setMessage('解析失敗：找不到「列」欄位。請確認標題包含「列」或「Col」。'); return; }

    const rawUnit = firstRow[unitKey];
    const rawYear = firstRow[yearKey];

    if (!rawUnit) { setStatus('error'); setMessage('解析失敗：首行資料的機組欄位為空。'); return; }
    if (!rawYear && rawYear !== 0) { setStatus('error'); setMessage('解析失敗：首行資料的年份欄位為空。'); return; }

    let y = parseInt(String(rawYear), 10);
    if (isNaN(y)) { setStatus('error'); setMessage('無法正確解析年份數字，請檢查格式。'); return; }
    if (y < 1911 && y > 0) y = y + 1911; // 民國 -> 西元

    // ===== 資料品質檢查 =====
    const warnings: string[] = [];
    const duplicates: any[] = [];
    const missing: any[] = [];
    setDuplicateList([]);
    setMissingList([]);

    // 1. 重複檢查：同一年份內，zone+row+col 組合不得重複
    const seen = new Map<string, number>(); // key -> first occurrence line的
    data.forEach((row, idx) => {
      const zone = zoneKey ? String(row[zoneKey] || '').trim() : '';
      const r = String(row[rowKey!] || '').trim();
      const c = String(row[colKey!] || '').trim();
      const key = `${zone}-${r}-${c}`;
      if (seen.has(key)) {
        duplicates.push({
          excelRow: idx + 2,
          origRow: seen.get(key)! + 2,
          zone,
          row: r,
          col: c
        });
      } else {
        seen.set(key, idx);
      }
    });

    if (duplicates.length > 0) {
      setStatus('error');
      setMessage(`驗證失敗：已成功解析 ${seen.size} 筆不重複資料，但發現 ${duplicates.length} 筆重複的紀錄。請檢查 Excel/CSV 後重新上傳。`);
      setDuplicateList(duplicates);
      return;
    }

    // 2. 遺失檢查：比對標準圖譜
    const masterMap = generateTubeMap();
    if (masterMap && Array.isArray(masterMap)) {
      masterMap.forEach(masterTube => {
         const key = `${masterTube.zone}-${masterTube.row}-${masterTube.col}`;
         if (!seen.has(key)) {
            missing.push(masterTube);
         }
      });
    }

    if (missing.length > 0) {
      warnings.push(`匯入資料共 ${seen.size} 筆，與該機組標準總管數 (${masterMap?.length || 6312} 筆) 不符，共遺失 ${missing.length} 筆。系統仍可上傳，但請確認是否僅檢測部分區域。`);
      setMissingList(missing);
    }

    if (warnings.length > 0) {
      setWarningMessage(warnings.join('\n'));
    }

    // ===== 通過驗證，執行上傳 =====
    setPendingYear(y);
    setPendingRecords(data);
    uploadRecords(data, y, '');
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
          <h4 className="font-medium text-slate-200 mb-3">CSV 必備欄位對應範例</h4>
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
                    if (e.key === 'Enter' && pendingYear) uploadRecords(pendingRecords, pendingYear, password);
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
                  onClick={() => pendingYear && uploadRecords(pendingRecords, pendingYear, password)}
                  className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg transition-colors"
                >
                  確認覆寫
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

