import React, { useState, useEffect, useMemo } from 'react';
import { Settings2, ShieldAlert, Wrench, AlertTriangle, Database, Plus, Trash2, Loader2, Play, Download, Save, Bookmark } from 'lucide-react';
import * as XLSX from 'xlsx';

interface DecisionSystemProps {
  unitData: any;
  onApplyToVisual?: (ids: string[]) => void;
}

interface Rule {
  id: string;
  formula: string;
  enabled: boolean;
}

const evaluateRule = (formula: string, context: any) => {
  if (!formula.trim()) return false;
  try {
    let safeFormula = formula.replace(/%/g, '');
    safeFormula = safeFormula.replace(/\+(\d+)/g, '$1');
    // Replace single '=' with '===' if not part of >=, <=, !=, ==
    safeFormula = safeFormula.replace(/(?<![=<>!])=(?![=])/g, '===');
    // Replace 'and' with '&&', 'or' with '||'
    safeFormula = safeFormula.replace(/\band\b/gi, '&&').replace(/\bor\b/gi, '||');

    const keys = Object.keys(context);
    const values = Object.values(context);
    const func = new Function(...keys, `return ${safeFormula};`);
    return func(...values);
  } catch (e) {
    return false;
  }
};

const DEFAULT_RULES: Rule[] = [
  { id: '1', formula: 'TubeAge >= 6 and depth_Diff > 30 and this_depth >= 40', enabled: true },
  { id: '2', formula: 'TubeAge >= 6 and depth_Diff > 35', enabled: true },
  { id: '3', formula: 'this_depth > 50', enabled: true },
  { id: '4', formula: 'Code = "COR"', enabled: true },
];

export default function DecisionSystem({ unitData, onApplyToVisual }: DecisionSystemProps) {
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [maintenanceYears, setMaintenanceYears] = useState<number[]>([]);
  const [currentSelection, setCurrentSelection] = useState<string>('');
  const [previousSelection, setPreviousSelection] = useState<string>('');
  
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  const [savedProfiles, setSavedProfiles] = useState<{name: string, rules: Rule[], remark?: string}[]>([]);
  const [activeProfile, setActiveProfile] = useState<string>('系統預設');

  const [suggestedList, setSuggestedList] = useState<any[]>([]);

  // 原始快取資料
  const [tubesData, setTubesData] = useState<any[]>([]);

  useEffect(() => {
    // 載入資料庫的公式情境
    fetch(`${import.meta.env.BASE_URL}api/profiles`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSavedProfiles(data);
        }
      })
      .catch(console.error);

    if (!unitData || !unitData.unit_id) return;
    
    setLoading(true);
    fetch(`${import.meta.env.BASE_URL}api/years?unit_id=${unitData.unit_id}`)
      .then(res => res.json())
      .then(async years => {
        if (!Array.isArray(years) || years.length === 0) {
           setLoading(false);
           return;
        }
        
        const sortedYears = years.sort((a,b) => b - a);
        setAvailableYears(sortedYears);

        const maintYears = await fetch(`${import.meta.env.BASE_URL}api/maintenance/years?unit_id=${unitData.unit_id}`).then(r => r.json());
        setMaintenanceYears(maintYears);

        // 初始化選擇
        const latest = sortedYears[0];
        let currSel = `${latest}-before`;
        if (maintYears.includes(latest)) currSel = `${latest}-after`;
        setCurrentSelection(currSel);

        let prevSel = '';
        if (sortedYears.length > 1) {
          const prevY = sortedYears[1];
          prevSel = maintYears.includes(prevY) ? `${prevY}-after` : `${prevY}-before`;
          setPreviousSelection(prevSel);
        }

        const tData = await fetch(`${import.meta.env.BASE_URL}api/tubes?unit_id=${unitData.unit_id}`).then(r => r.json());
        setTubesData(tData);

        setLoading(false);
      })
      .catch(err => {
         console.error(err);
         setLoading(false);
      });
  }, [unitData]);

  const fetchStateData = async (selection: string, unitId: string) => {
    if (!selection) return new Map();
    const [yearStr, mode] = selection.split('-');
    const year = Number(yearStr);
    const recordsRes = await fetch(`${import.meta.env.BASE_URL}api/records?unit_id=${unitId}&year=${year}`).then(r => r.json());
    
    let maintenanceRes: any[] = [];
    if (mode === 'after') {
      maintenanceRes = await fetch(`${import.meta.env.BASE_URL}api/maintenance?unit_id=${unitId}&year=${year}`).then(r => r.json());
    }

    const map = new Map<string, any>();
    if (Array.isArray(recordsRes)) {
      recordsRes.forEach(r => {
        const id = `${r.zone}-${r.row_num}-${r.col_num}`;
        let isPlugged = r.code === 'PLG';
        let isReplaced = false;
        let depth = Number(r.size_val) || 0;
        const code = r.code || 'NDD';

        if (mode === 'after') {
          const mainAction = maintenanceRes.find(m => m.zone === r.zone && m.row_num === r.row_num && m.col_num === r.col_num);
          if (mainAction) {
            if (mainAction.action === 'PLG') {
              isPlugged = true;
            } else if (mainAction.action === 'RPL') {
              isPlugged = false;
              isReplaced = true;
              depth = 0;
            }
          } else {
            if (depth > 50) isPlugged = true;
            if (code === 'COR') isPlugged = true;
          }
        }
        
        map.set(id, { id, zone: r.zone, depth, isPlugged, isReplaced, code });
      });
    }
    return map;
  };

  const addRule = () => {
    setRules([...rules, { id: Date.now().toString(), formula: '', enabled: true }]);
  };

  const updateRule = (id: string, formula: string) => {
    setRules(rules.map(r => r.id === id ? { ...r, formula } : r));
  };

  const toggleRule = (id: string) => {
    setRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const removeRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id));
  };

  const handleSaveProfile = async () => {
    const name = prompt('請輸入此篩選腳本的名稱 (例如: 嚴格策略)：');
    if (!name) return;
    const remark = prompt('請撰寫備註說明 (選填，例如: 用於大修年度全面檢測)：') || '';
    
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, remark, rules })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(`儲存失敗 (${res.status})：${errData.error || '伺服器錯誤，請確認 decision_profiles 資料表是否已建立。'}`);
        return;
      }
      const newProfiles = [...savedProfiles.filter(p => p.name !== name), { name, remark, rules }];
      setSavedProfiles(newProfiles);
      setActiveProfile(name);
      alert(`✅ 公式「${name}」已成功儲存至伺服器！`);
    } catch (e) {
      alert('儲存失敗，請檢查網路連線或伺服器狀態。');
    }
  };

  const handleLoadProfile = (name: string) => {
    setActiveProfile(name);
    if (name === '系統預設') {
      setRules(DEFAULT_RULES);
      return;
    }
    const profile = savedProfiles.find(p => p.name === name);
    if (profile) {
      setRules(profile.rules);
    }
  };

  const handleDeleteProfile = async () => {
    if (activeProfile === '系統預設') return;
    if (!confirm(`確定要刪除 "${activeProfile}" 嗎？\n此動作將會從資料庫移除，所有使用者皆無法再共用。`)) return;
    
    try {
      await fetch(`${import.meta.env.BASE_URL}api/profiles/${encodeURIComponent(activeProfile)}`, { method: 'DELETE' });
      const newProfiles = savedProfiles.filter(p => p.name !== activeProfile);
      setSavedProfiles(newProfiles);
      setActiveProfile('系統預設');
      setRules(DEFAULT_RULES);
    } catch (e) {
      alert('刪除失敗，請檢查伺服器狀態。');
    }
  };

  const runAnalysis = async () => {
    if (!currentSelection || !previousSelection) return;
    setAnalyzing(true);
    setSuggestedList([]);

    try {
      const [currMap, prevMap] = await Promise.all([
        fetchStateData(currentSelection, unitData.unit_id),
        fetchStateData(previousSelection, unitData.unit_id)
      ]);

      const activeRules = rules.filter(r => r.enabled && r.formula.trim().length > 0);
      const suggestions: any[] = [];
      const currentYear = new Date().getFullYear();
      
      const commissionYear = unitData.commission_year || 2018;
      const [currYearStr] = currentSelection.split('-');
      const latestYear = Number(currYearStr);

      const tubeMap = new Map();
      if (Array.isArray(tubesData)) {
         tubesData.forEach(t => {
           tubeMap.set(`${t.zone}-${t.row_num}-${t.col_num}`, t);
         });
      }

      currMap.forEach((curr, id) => {
        // 已經被塞管的，或因為大修已被判定 PLG 就不算異常管了
        if (curr.isPlugged) return;

        const prev = prevMap.get(id);
        const this_depth = curr.depth;
        const prev_depth = prev ? prev.depth : 0;
        const Code = curr.code;
        
        const depth_Diff = this_depth > prev_depth ? (this_depth - prev_depth) : 0;
        
        const tubeMeta = tubeMap.get(id);
        const installYear = tubeMeta?.install_year || commissionYear;
        const TubeAge = latestYear > 0 ? (latestYear - installYear) : (currentYear - installYear);

        const context = { TubeAge, depth_Diff, this_depth, previous_depth: prev_depth, Code };

        const matchedRules: string[] = [];
        activeRules.forEach((rule, index) => {
          if (evaluateRule(rule.formula, context)) {
            matchedRules.push(`規則 ${index + 1}: ${rule.formula}`);
          }
        });

        if (matchedRules.length > 0) {
          suggestions.push({
            id,
            quadrant: curr.zone,
            TubeAge,
            this_depth,
            depth_Diff,
            Code,
            reasons: matchedRules
          });
        }
      });

      setSuggestedList(suggestions.sort((a, b) => b.this_depth - a.this_depth));
    } catch (e) {
      console.error(e);
    } finally {
      setAnalyzing(false);
    }
  };

  const exportToExcel = () => {
    if (suggestedList.length === 0) return;
    const rows = suggestedList.map(item => {
      const parts = item.id.split('-');
      return {
        '區域': parts[0] || '',
        '行/Row': Number(parts[1]) || parts[1] || '',
        '列/Col': Number(parts[2]) || parts[2] || '',
        '管齡(年)': item.TubeAge,
        '本次深度(%)': parseFloat(item.this_depth.toFixed(1)),
        '深度差異(%)': parseFloat(item.depth_Diff.toFixed(1)),
        '觸發條件': item.reasons.join(' | ')
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    // 設定欄寬
    ws['!cols'] = [
      { wch: 8 },  // 區域
      { wch: 8 },  // 行/Row
      { wch: 8 },  // 列/Col
      { wch: 10 }, // 管齡
      { wch: 14 }, // 本次深度
      { wch: 14 }, // 深度差異
      { wch: 50 }, // 觸發條件
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '建議處置清單');
    XLSX.writeFile(wb, `${unitData.unit_id}_建議處置清單.xlsx`);
  };

  if (!unitData || !unitData.unit_id) {
    return (
      <div className="flex flex-col items-center justify-center p-20 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
        <Database className="w-12 h-12 text-slate-700 mb-4 animate-pulse" />
        <h3 className="text-xl font-bold text-slate-300">尚未載入機組資料</h3>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <h3 className="text-xl font-bold text-slate-300">載入歷史與管束資料中...</h3>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold text-white">處置篩選系統 {unitData.commission_year && <span className="text-sm font-normal text-slate-400 ml-2">(建廠年份: {unitData.commission_year})</span>}</h2>
        <p className="text-slate-400">定義篩選條件公式，快速從數千筆檢測資料中找出高風險管束</p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 px-4 py-3 bg-slate-900/50 border border-slate-800 rounded-lg">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-300 whitespace-nowrap">本次比對狀態:</label>
            <select 
              value={currentSelection} 
              onChange={(e) => setCurrentSelection(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-1.5 text-sm focus:ring-blue-500 focus:border-blue-500 font-medium"
            >
              {availableYears.map(y => (
                <optgroup key={`curr-${y}`} label={`${y} 年份`}>
                  {maintenanceYears.includes(y) && (
                    <option value={`${y}-after`}>{y} (大修處理後)</option>
                  )}
                  <option value={`${y}-before`}>{y} (大修檢測基準)</option>
                </optgroup>
              ))}
            </select>
          </div>
          <div className="hidden sm:block text-slate-500 font-bold px-4 py-1 bg-slate-800/50 rounded-lg">VS</div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-300 whitespace-nowrap">基準比對狀態:</label>
            <select 
              value={previousSelection} 
              onChange={(e) => setPreviousSelection(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-1.5 text-sm focus:ring-blue-500 focus:border-blue-500 font-medium"
            >
              {availableYears.map(y => (
                <optgroup key={`prev-${y}`} label={`${y} 年份`}>
                  {maintenanceYears.includes(y) && (
                    <option value={`${y}-after`}>{y} (大修處理後)</option>
                  )}
                  <option value={`${y}-before`}>{y} (大修檢測基準)</option>
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        
        {/* 公式腳本存取 */}
        <div className="flex flex-col gap-2 pl-0 sm:pl-6 sm:border-l border-slate-700 w-full sm:w-auto">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-blue-400 whitespace-nowrap">
              <Bookmark size={16} />
              <span className="text-sm font-medium">套用公式:</span>
            </div>
            <select
              value={activeProfile}
              onChange={(e) => handleLoadProfile(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-blue-300 rounded-md px-3 py-1.5 text-sm font-bold min-w-[120px]"
            >
              <option value="系統預設">系統預設</option>
              {savedProfiles.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <button 
              onClick={handleSaveProfile}
              className="flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1.5 rounded transition whitespace-nowrap"
              title="將當前公式組合儲存至資料庫"
            >
              <Save size={14} /> 儲存目前組合
            </button>
            {activeProfile !== '系統預設' && (
              <button 
                onClick={handleDeleteProfile}
                className="p-1.5 text-red-400 hover:bg-red-500/20 rounded"
                title="從資料庫刪除"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {activeProfile !== '系統預設' && savedProfiles.find(p => p.name === activeProfile)?.remark && (
            <div className="text-xs text-slate-400 italic">
              ↳ 備註: {savedProfiles.find(p => p.name === activeProfile)?.remark}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800 h-fit">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Settings2 className="text-blue-500" />
              <h3 className="text-lg font-semibold text-slate-100">自訂篩選公式</h3>
            </div>
            <button 
              onClick={addRule}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded flex items-center gap-1"
            >
              <Plus size={14} /> 新增
            </button>
          </div>
          
          <div className="space-y-3">
            {rules.map((rule, i) => (
              <div key={rule.id} className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      checked={rule.enabled} 
                      onChange={() => toggleRule(rule.id)}
                      className="accent-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-300">規則 {i + 1}</span>
                  </div>
                  <button onClick={() => removeRule(rule.id)} className="text-slate-500 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
                <input 
                  type="text"
                  value={rule.formula}
                  onChange={(e) => updateRule(rule.id, e.target.value)}
                  placeholder={`例如: TubeAge >= 6 and this_depth > 40`}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-blue-300 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800 space-y-3">
            <div className="text-xs text-slate-500 font-mono bg-slate-950 p-3 rounded">
              可使用變數：<br/>
              • <span className="text-blue-400">TubeAge</span>: 管齡(年)<br/>
              • <span className="text-blue-400">depth_Diff</span>: 深度差異(%)<br/>
              • <span className="text-blue-400">this_depth</span>: 當前深度(%)<br/>
              • <span className="text-blue-400">previous_depth</span>: 前次深度(%)<br/>
              • <span className="text-blue-400">Code</span>: 種類字串(例如 "COR")
            </div>
            
            <button 
              onClick={runAnalysis}
              disabled={analyzing}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {analyzing ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
              {analyzing ? '篩選運算中...' : '執行篩選'}
            </button>
          </div>
        </div>

        <div className="lg:col-span-8 bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="text-red-500" />
              <h3 className="text-lg font-semibold text-slate-100">建議處置清單</h3>
            </div>
            <div className="flex items-center gap-3">
              {onApplyToVisual && (
                <button
                  onClick={() => onApplyToVisual(suggestedList.map(item => item.id))}
                  disabled={suggestedList.length === 0}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                  title="將結果套用至動態視覺檢視的畫布上"
                >
                  <Play size={14} /> 在視覺圖中檢視
                </button>
              )}
              <button
                onClick={exportToExcel}
                disabled={suggestedList.length === 0}
                className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
              >
                <Download size={14} /> 處置清單下載
              </button>
              <div className="text-sm font-medium bg-red-900/20 text-red-400 px-3 py-1 rounded-full">
                共 {suggestedList.length} 支管需處理
              </div>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-900 shadow-sm z-10">
                <tr className="bg-slate-800/50 border-y border-slate-800">
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">區域</th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">行/Row</th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">列/Col</th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">管齡</th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">本次深度</th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400 whitespace-nowrap">深度差異</th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">觸發條件</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {suggestedList.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/50">
                    {(() => { const parts = item.id.split('-'); return (<>
                      <td className="py-3 px-4 text-sm font-bold text-blue-300">{parts[0]}</td>
                      <td className="py-3 px-4 text-sm font-medium text-white">{parts[1]}</td>
                      <td className="py-3 px-4 text-sm font-medium text-white">{parts[2]}</td>
                    </>); })()}
                    <td className="py-3 px-4 text-sm text-slate-300">{item.TubeAge} 年</td>
                    <td className="py-3 px-4 text-sm text-red-400 font-bold">{item.this_depth.toFixed(1)}%</td>
                    <td className="py-3 px-4 text-sm font-bold text-amber-500">
                      +{item.depth_Diff.toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400 max-w-[200px]">
                      <ul className="list-disc pl-4 space-y-0.5">
                        {item.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                      </ul>
                    </td>
                  </tr>
                ))}
                {suggestedList.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      目前無符合條件的建議項目，點擊「執行篩選」開始檢查。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
