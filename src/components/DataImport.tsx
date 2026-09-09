import React, { useState, useEffect } from 'react';
import { 
  Upload, FileType, CheckCircle2, AlertCircle, KeyRound, Loader2, X, Info, Download, 
  History, Eye, RefreshCw, Search, Clock, FileSpreadsheet, ShieldAlert, FileText 
} from 'lucide-react';
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
  const [currentFileName, setCurrentFileName] = useState<string>('');

  // 歷史上傳紀錄狀態
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilterType, setHistoryFilterType] = useState<'all' | 'maintenance' | 'inspection'>('all');
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<any | null>(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);
  const [detailSearchTerm, setDetailSearchTerm] = useState('');

  // 取得歷史上傳紀錄
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      let url = `${import.meta.env.BASE_URL}api/upload_history?unit_id=${unitId}`;
      if (historyFilterType !== 'all') {
        url += `&data_type=${historyFilterType}`;
      }
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setHistoryList(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [unitId, historyFilterType]);

  // 檢視歷史上傳明細快照
  const viewHistoryDetail = async (item: any) => {
    setSelectedHistoryItem(item);
    setHistoryDetailLoading(true);
    setDetailSearchTerm('');
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/upload_history/${item.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedHistoryItem(data);
      }
    } catch (err) {
      console.error('Failed to fetch upload detail:', err);
    } finally {
      setHistoryDetailLoading(false);
    }
  };

  // 匯出快照為 CSV
  const downloadSnapshotCSV = (item: any) => {
    if (!item || !item.records_snapshot || item.records_snapshot.length === 0) return;
    const isMaint = item.data_type === 'maintenance';
    const csvData = item.records_snapshot.map((r: any) => {
      if (isMaint) {
        return {
          '機組': item.unit_id,
          '年份': item.year,
          '區域': r.zone,
          '行': r.row_num,
          '列': r.col_num,
          '處置': r.action,
          '新材質': r.new_material || '',
          '備註': r.notes || ''
        };
      } else {
        return {
          '機組': item.unit_id,
          '年份': item.year,
          '區域': r.zone,
          '行': r.row_num,
          '列': r.col_num,
          '頻道': r.channel || '',
          '瑕疵': r.code,
          '深度': r.size_val,
          '備註': r.notes || ''
        };
      }
    });

    const csvStr = Papa.unparse(csvData);
    const blob = new Blob(["\uFEFF" + csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${item.unit_id}_${item.year}_${isMaint ? '大修處置' : '檢測結果'}_上傳快照.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 格式化台北時間 (UTC+8)
  const formatTaipeiTime = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(d);
    } catch {
      return dateStr;
    }
  };

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
      const bodyPayload = { 
        records, 
        password: pass, 
        unit_id: unitId,
        fileName: currentFileName || (importMode === 'before' ? `${unitId}_檢測資料.xlsx` : `${unitId}_大修處置.xlsx`)
      };

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
      fetchHistory(); // 重新整理歷史紀錄
    } catch (err: any) {
      setStatus('error');
      setMessage(`上傳失敗: ${err.message}`);
    }
  };

  const processFile = (file: File) => {
    setCurrentFileName(file.name);
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
    const channelKey = keys.find(k => k.includes('頻道') || k.toLowerCase().includes('channel'));
    const actionKey = keys.find(k => k.includes('處置') || k.toLowerCase().includes('action'));
    const materialKey = keys.find(k => k.includes('材質') || k.toLowerCase().includes('material'));
    let notesKey = keys.find(k => k.includes('備註') || k.toLowerCase().includes('notes'));
    if (!notesKey) {
      notesKey = '備註';
    }

    if (!unitKey) { setStatus('error'); setMessage('解析失敗：找不到「機組」欄位。'); return; }
    if (!yearKey) { setStatus('error'); setMessage('解析失敗：找不到「年份」欄位。'); return; }
    if (!rowKey)  { setStatus('error'); setMessage('解析失敗：找不到「行/Row」欄位。'); return; }
    if (!colKey)  { setStatus('error'); setMessage('解析失敗：找不到「列/Col」欄位。'); return; }
    if (importMode === 'after' && !actionKey) { setStatus('error'); setMessage('解析失敗：找不到「處置/action」欄位。'); return; }

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
      const invalidActions: any[] = [];
      
      const finalYearData: any[] = [];
      const mergedRecords: any[] = [];

      yearData.forEach(row => {
        const zone = zoneKey ? String(row[zoneKey] || '').trim().toUpperCase() : '';
        const rawR = String(row[rowKey!] || '').trim();
        const rawC = String(row[colKey!] || '').trim();
        
        const r = isNaN(parseInt(rawR, 10)) ? rawR : parseInt(rawR, 10).toString();
        const c = isNaN(parseInt(rawC, 10)) ? rawC : parseInt(rawC, 10).toString();
        
        const key = `${zone}-${r}-${c}`;
        seenTubes.add(key);
        
        if (seenRecords.has(key)) {
          const existingRow = seenRecords.get(key);
          const existingCode = codeKey ? String(existingRow[codeKey] || '').trim().toUpperCase() : '';
          const newCode = codeKey ? String(row[codeKey] || '').trim().toUpperCase() : '';
          
          if (
            (existingCode === 'PIT' && newCode === 'DNT') || 
            (existingCode === 'DNT' && newCode === 'PIT') ||
            (existingCode === 'PIT' && newCode === 'NDD') || 
            (existingCode === 'NDD' && newCode === 'PIT')
          ) {
            let subCode = newCode;
            let finalCode = existingCode;
            if (newCode === 'PIT') {
              if (codeKey) existingRow[codeKey] = row[codeKey];
              if (sizeKey) existingRow[sizeKey] = row[sizeKey];
              subCode = existingCode;
              finalCode = 'PIT';
            }
            // Add note to existingRow, appending if there is already a note
            if (existingRow[notesKey]) {
              existingRow[notesKey] += ` (也檢測到${subCode})`;
            } else {
              existingRow[notesKey] = `也檢測到${subCode}`;
            }

            mergedRecords.push({
               zone, row: r, col: c, 
               originalCodes: `${existingCode} 與 ${newCode}`,
               finalResult: `${finalCode} (備註: 也檢測到${subCode})`
            });
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
          
          // 轉換為標準化格式，確保後端絕對能正確解析
          const code = codeKey ? String(row[codeKey] || '').trim().toUpperCase() : 'NDD';
          const size = sizeKey ? parseFloat(row[sizeKey]) || 0 : 0;
          const channel = channelKey ? String(row[channelKey] || '').trim() : '';
          const notes = String(row[notesKey] || '');
          
          if (importMode === 'after') {
            const action = actionKey ? String(row[actionKey] || '').trim().toUpperCase() : '';
            const newMaterial = materialKey ? String(row[materialKey] || '').trim() : '';

            if (!action) {
              invalidActions.push({
                excelRow: row._originalIndex,
                zone, row: r, col: c
              });
              return;
            }

            finalYearData.push({
              "機組/Unit": unitId,
              "年份": year,
              "區域/Zone": zone,
              "行/Row": parseInt(r, 10),
              "列/Col": parseInt(c, 10),
              "處置/action": action,
              "新材質/new_material": newMaterial,
              "備註/notes": notes
            });
          } else {
            finalYearData.push({
              "機組/Unit": unitId,
              "年份": year,
              "區域/Zone": zone,
              "行/Row": parseInt(r, 10),
              "列/Col": parseInt(c, 10),
              "頻道/Channel": channel,
              "瑕疵/Code": code,
              "深度/Size": size,
              "備註": notes
            });
          }
        }
      });

      let missingDetails: string[] = [];
      let totalMissing = 0;
      let totalUnexpected = 0;
      
      if (importMode === 'before') {
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
      }

      // 檢查是否有上傳了不在標準象限內的區域
      zonesCount.forEach((actualCount, z) => {
        if (!expectedPerZone.has(z)) {
          totalUnexpected += actualCount;
          missingDetails.push(`[${z}] 為未知象限，共 ${actualCount} 筆`);
        }
      });

      if (invalidActions.length > 0) {
        totalUnexpected += invalidActions.length;
        missingDetails.push(`處置/action 空白，共 ${invalidActions.length} 筆`);
      }
      
      const missingTubes: any[] = [];
      if (importMode === 'before' && masterMap && Array.isArray(masterMap)) {
         masterMap.forEach((t: any) => {
            const tz = String(t.zone || '').trim().toUpperCase();
            const rawTr = String(t.row || '').trim();
            const rawTc = String(t.col || '').trim();
            const tr = isNaN(parseInt(rawTr, 10)) ? rawTr : parseInt(rawTr, 10).toString();
            const tc = isNaN(parseInt(rawTc, 10)) ? rawTc : parseInt(rawTc, 10).toString();
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
        mergedRecords,
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
      if (s.action === 'upload' || s.action === 'upload_with_plg') {
        recordsToUpload.push(...s.records);

        if (s.action === 'upload_with_plg' && s.missingTubes) {
          const plgTubes = s.missingTubes.map((t: any) => ({
            ...t,
            "機組/Unit": unitId,
            "年份": s.year,
            "瑕疵/Code": "PLG",
            "深度/Size": 0
          }));
          recordsToUpload.push(...plgTubes);
        }
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
    <div className="space-y-6 w-full relative">
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

      {/* ================================================================ */}
      {/* 歷史上傳與處置紀錄 (Upload History) */}
      {/* ================================================================ */}
      <div className="bg-slate-900 p-8 rounded-xl shadow-sm border border-slate-800 mt-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <History size={20} className="text-blue-400" />
              歷史上傳與處置紀錄
              <span className="text-xs font-normal px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                目前機組：{unitId}
              </span>
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              追蹤每次上傳的檔案名稱、操作時間（台北時間 UTC+8）、筆數摘要與明細快照。即使資料庫年度被覆寫，歷史版本仍可隨時追溯比對。
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* 篩選按鈕 */}
            <div className="inline-flex rounded-lg border border-slate-700 p-1 bg-slate-950">
              <button
                onClick={() => setHistoryFilterType('all')}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  historyFilterType === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setHistoryFilterType('maintenance')}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  historyFilterType === 'maintenance'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                大修處置 (After)
              </button>
              <button
                onClick={() => setHistoryFilterType('inspection')}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  historyFilterType === 'inspection'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                檢測結果 (Before)
              </button>
            </div>

            <button
              onClick={fetchHistory}
              disabled={historyLoading}
              title="重新整理歷史紀錄"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={historyLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* 歷史列表表格 */}
        <div className="mt-6 overflow-x-auto">
          {historyLoading && historyList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 className="animate-spin text-blue-500 mb-2" size={24} />
              <p className="text-sm">正在載入歷史上傳紀錄...</p>
            </div>
          ) : historyList.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-slate-800 rounded-lg">
              <FileSpreadsheet className="mx-auto text-slate-600 mb-2" size={36} />
              <p className="text-slate-400 font-medium">尚無 {unitId} 的歷史上傳紀錄</p>
              <p className="text-xs text-slate-500 mt-1">上傳檢測結果或大修處置後，系統將自動記錄於此。</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left text-slate-300">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase bg-slate-950/40">
                  <th className="py-3 px-4">上傳時間 (台北時間)</th>
                  <th className="py-3 px-4">機組</th>
                  <th className="py-3 px-4">類別</th>
                  <th className="py-3 px-4">年度</th>
                  <th className="py-3 px-4">原始檔名</th>
                  <th className="py-3 px-4">總筆數</th>
                  <th className="py-3 px-4">摘要統計</th>
                  <th className="py-3 px-4">狀態</th>
                  <th className="py-3 px-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {historyList.map((item) => {
                  const isMaint = item.data_type === 'maintenance';
                  const summary = item.action_summary || {};
                  return (
                    <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-300 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock size={13} className="text-slate-500 shrink-0" />
                          {formatTaipeiTime(item.created_at)}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-orange-300 border border-slate-700">
                          {item.unit_id}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          isMaint
                            ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/70'
                            : 'bg-blue-950/70 text-blue-300 border-blue-800/70'
                        }`}>
                          {isMaint ? '大修處置 (After)' : '檢測結果 (Before)'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-medium text-white">
                        {item.year}
                      </td>
                      <td className="py-3.5 px-4 max-w-[320px] truncate text-slate-300 text-xs" title={item.file_name}>
                        <div className="flex items-center gap-1.5">
                          <FileText size={14} className="text-slate-500 shrink-0" />
                          <span className="truncate">{item.file_name || '-'}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-medium text-slate-200">
                        {item.record_count} 筆
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1 max-w-[280px]">
                          {Object.entries(summary).slice(0, 3).map(([key, val]) => (
                            <span key={key} className="px-1.5 py-0.5 text-[11px] rounded bg-slate-800/80 text-slate-300 border border-slate-700">
                              {key}: <span className="font-bold text-white">{String(val)}</span>
                            </span>
                          ))}
                          {Object.keys(summary).length > 3 && (
                            <span className="text-[10px] text-slate-500 self-center">
                              +{Object.keys(summary).length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {item.is_overwrite ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/60 text-amber-400 border border-amber-800/60">
                            覆寫更新
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                            正常寫入
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => viewHistoryDetail(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-white rounded-md border border-blue-700/50 text-xs transition-colors"
                        >
                          <Eye size={13} />
                          查看明細
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* 歷史上傳明細快照檢視彈窗 (Detail Modal) */}
      {/* ================================================================ */}
      {selectedHistoryItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[950px] max-w-full max-h-[88vh] flex flex-col overflow-hidden">
            {/* 彈窗 Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-950/50">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  selectedHistoryItem.data_type === 'maintenance' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-blue-950 text-blue-400 border border-blue-800'
                }`}>
                  <FileSpreadsheet size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-white text-base flex items-center gap-2">
                    上傳明細快照：{selectedHistoryItem.file_name || '無檔名'}
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    上傳時間：{formatTaipeiTime(selectedHistoryItem.created_at)} ｜ 處理人員：{selectedHistoryItem.uploaded_by || '系統使用者'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedHistoryItem(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* 彈窗資訊列 */}
            <div className="px-6 py-3 bg-slate-900/80 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span className="px-2.5 py-1 rounded bg-slate-800 text-orange-300 font-semibold border border-slate-700">
                  機組：{selectedHistoryItem.unit_id}
                </span>
                <span className="px-2.5 py-1 rounded bg-slate-800 text-white font-semibold border border-slate-700">
                  年度：{selectedHistoryItem.year} 年
                </span>
                <span className={`px-2.5 py-1 rounded font-medium border ${
                  selectedHistoryItem.data_type === 'maintenance'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : 'bg-blue-950 text-blue-300 border-blue-800'
                }`}>
                  {selectedHistoryItem.data_type === 'maintenance' ? '大修處置 (After)' : '檢測結果 (Before)'}
                </span>
                <span className="text-slate-400">
                  總記錄數：<strong className="text-white">{selectedHistoryItem.record_count}</strong> 筆
                </span>
                {selectedHistoryItem.action_summary && (
                  <div className="flex items-center gap-1.5 pl-2 border-l border-slate-700">
                    {Object.entries(selectedHistoryItem.action_summary).map(([k, v]) => (
                      <span key={k} className="px-2 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700 text-[11px]">
                        {k}: <strong className="text-blue-300">{String(v)}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 匯出 CSV 按鈕 */}
              <button
                onClick={() => downloadSnapshotCSV(selectedHistoryItem)}
                disabled={historyDetailLoading || !selectedHistoryItem.records_snapshot || selectedHistoryItem.records_snapshot.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md border border-slate-700 transition-colors disabled:opacity-50"
              >
                <Download size={14} />
                下載此快照 CSV
              </button>
            </div>

            {/* 搜尋過濾列 */}
            <div className="px-6 py-3 bg-slate-950/30 border-b border-slate-800">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
                <input
                  type="text"
                  value={detailSearchTerm}
                  onChange={(e) => setDetailSearchTerm(e.target.value)}
                  placeholder="過濾搜尋：輸入區域 (如 IR/OL)、行號、列號或備註關鍵字..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* 明細表格本體 (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {historyDetailLoading ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Loader2 className="animate-spin text-blue-500 mb-2" size={28} />
                  <p className="text-sm">正在讀取完整快照資料...</p>
                </div>
              ) : !selectedHistoryItem.records_snapshot || selectedHistoryItem.records_snapshot.length === 0 ? (
                <div className="text-center py-16 text-slate-500 text-sm">
                  此筆歷史紀錄未包含原始快照資料。
                </div>
              ) : (() => {
                const isMaint = selectedHistoryItem.data_type === 'maintenance';
                const sTerm = detailSearchTerm.trim().toLowerCase();
                const filtered = selectedHistoryItem.records_snapshot.filter((r: any) => {
                  if (!sTerm) return true;
                  const z = String(r.zone || '').toLowerCase();
                  const row = String(r.row_num || '');
                  const col = String(r.col_num || '');
                  const act = String(r.action || r.code || '').toLowerCase();
                  const notes = String(r.notes || '').toLowerCase();
                  const loc = `${z}-${row}-${col}`;
                  return z.includes(sTerm) || row === sTerm || col === sTerm || act.includes(sTerm) || notes.includes(sTerm) || loc.includes(sTerm);
                });

                return (
                  <div>
                    <div className="flex justify-between items-center text-xs text-slate-500 mb-2">
                      <span>顯示 {filtered.length} / {selectedHistoryItem.records_snapshot.length} 筆資料</span>
                    </div>
                    <table className="w-full text-xs text-left text-slate-300">
                      <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400 uppercase">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">區域 (Zone)</th>
                          <th className="py-2.5 px-3">行 (Row)</th>
                          <th className="py-2.5 px-3">列 (Col)</th>
                          {isMaint ? (
                            <>
                              <th className="py-2.5 px-3">處置動作 (Action)</th>
                              <th className="py-2.5 px-3">新材質 (New Material)</th>
                            </>
                          ) : (
                            <>
                              <th className="py-2.5 px-3">頻道 (Channel)</th>
                              <th className="py-2.5 px-3">瑕疵碼 (Code)</th>
                              <th className="py-2.5 px-3">深度 (Size %)</th>
                            </>
                          )}
                          <th className="py-2.5 px-3">備註說明 (Notes)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50 font-mono">
                        {filtered.slice(0, 300).map((r: any, idx: number) => {
                          const actionCode = (isMaint ? r.action : r.code) || '';
                          const isPlug = actionCode === 'PLG' || actionCode === '塞管';
                          const isRetube = actionCode === 'RPL' || actionCode === '換管';
                          return (
                            <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                              <td className="py-2 px-3 text-slate-500">{idx + 1}</td>
                              <td className="py-2 px-3 font-semibold text-slate-300">{r.zone}</td>
                              <td className="py-2 px-3 text-slate-200">{r.row_num}</td>
                              <td className="py-2 px-3 text-slate-200">{r.col_num}</td>
                              {isMaint ? (
                                <>
                                  <td className="py-2 px-3">
                                    <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                                      isPlug ? 'bg-red-950 text-red-400 border border-red-800' :
                                      isRetube ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                                      'bg-slate-800 text-slate-300'
                                    }`}>
                                      {r.action}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-slate-400">{r.new_material || '-'}</td>
                                </>
                              ) : (
                                <>
                                  <td className="py-2 px-3 text-slate-400">{r.channel || '-'}</td>
                                  <td className="py-2 px-3">
                                    <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                                      r.code === 'PIT' ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                                      r.code === 'PLG' ? 'bg-red-950 text-red-400 border border-red-800' :
                                      'bg-slate-800 text-slate-300'
                                    }`}>
                                      {r.code}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-slate-200">
                                    {r.size_val > 0 ? `${r.size_val}%` : '-'}
                                  </td>
                                </>
                              )}
                              <td className="py-2 px-3 font-sans text-slate-400 max-w-[250px] truncate" title={r.notes || ''}>
                                {r.notes || '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filtered.length > 300 && (
                      <div className="py-3 text-center text-xs text-slate-500 italic bg-slate-950/40 rounded mt-2">
                        已預覽前 300 筆，若需查看完整資料請點擊上方「下載此快照 CSV」。
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* 彈窗 Footer */}
            <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/50 flex justify-end">
              <button
                onClick={() => setSelectedHistoryItem(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
              >
                關閉視窗
              </button>
            </div>
          </div>
        </div>
      )}

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
                    <div className="flex-1 pr-4">
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
                                <p className="text-red-300">資料異常細節：</p>
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
                      
                      {s.mergedRecords && s.mergedRecords.length > 0 && (
                        <div className="mt-3 bg-blue-900/10 border border-blue-800/50 rounded p-3 text-sm">
                          <p className="flex items-center gap-1 text-blue-400 font-medium mb-2">
                            <Info size={16} /> 自動合併 {s.mergedRecords.length} 筆雙重瑕疵紀錄 (PIT+NDD/DNT)：
                          </p>
                          <div className="max-h-24 overflow-y-auto text-xs font-mono text-blue-200/80 space-y-1">
                            {s.mergedRecords.map((m: any, i: number) => (
                              <div key={i} className="flex gap-2">
                                <span className="text-blue-300 w-24">({m.zone}-{m.row}-{m.col})</span>
                                <span className="text-slate-400">{m.originalCodes} ➔ {m.finalResult}</span>
                              </div>
                            ))}
                          </div>
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
                        {s.status === 'error' && s.missing > 0 && s.duplicates === 0 && s.unexpected === 0 && (
                          <option value="upload_with_plg">自動將缺少管束補為塞管(PLG)並上傳</option>
                        )}
                        <option value="skip">忽略此年份 (不上傳)</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-800 shrink-0">
              <p className="text-sm text-slate-400">
                將上傳 <span className="text-white font-bold">{validationSummary.filter(s => s.action === 'upload' || s.action === 'upload_with_plg').length}</span> 個年份的資料
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
                  disabled={validationSummary.filter(s => s.action === 'upload' || s.action === 'upload_with_plg').length === 0}
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

