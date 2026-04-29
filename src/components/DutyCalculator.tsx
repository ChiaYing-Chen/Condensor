import React, { useState, useEffect } from 'react';
import { Loader2, Calculator, Info } from 'lucide-react';

interface DutyCalculatorProps {
  unitId: string;
}

export default function DutyCalculator({ unitId }: DutyCalculatorProps) {
  const [loading, setLoading] = useState(true);
  
  const [c4430t, setC4430t] = useState(0);
  const [c7150t, setC7150t] = useState(0);
  const [plugged, setPlugged] = useState(0);

  const [baseC4430t, setBaseC4430t] = useState(0);
  const [baseC7150t, setBaseC7150t] = useState(0);
  const [basePlugged, setBasePlugged] = useState(0);

  useEffect(() => {
    setLoading(true);

    const fetchData = async () => {
      try {
        // 1. 取得最新年份
        const yearsRes = await fetch(`${import.meta.env.BASE_URL}api/years?unit_id=${unitId}`).then(r => r.json());
        if (!Array.isArray(yearsRes) || yearsRes.length === 0) {
          setLoading(false);
          return;
        }
        const sortedYears = yearsRes.sort((a, b) => a - b);
        const currentYear = sortedYears[sortedYears.length - 1];

        // 2. 取得維護年份，決定是否為 after
        const mYears = await fetch(`${import.meta.env.BASE_URL}api/maintenance/years?unit_id=${unitId}`).then(r => r.json());
        const maintArr = Array.isArray(mYears) ? mYears : [];
        const hasMaint = maintArr.includes(currentYear);
        const viewMode = hasMaint ? 'after' : 'before';

        // 3. 取得 records, maint, tubes
        const [recordsRes, maintRes, tubesRes] = await Promise.all([
          fetch(`${import.meta.env.BASE_URL}api/records?unit_id=${unitId}&year=${currentYear}`).then(r => r.json()),
          fetch(`${import.meta.env.BASE_URL}api/maintenance?unit_id=${unitId}&year=${currentYear}`).then(r => r.json()),
          fetch(`${import.meta.env.BASE_URL}api/tubes?unit_id=${unitId}`).then(r => r.json()),
        ]);

        const currentPluggedSet = new Set<string>();
        const retubedMatMap = new Map<string, string>();

        if (Array.isArray(recordsRes)) {
          const hasMaintenance = Array.isArray(maintRes) && maintRes.length > 0;
          recordsRes.forEach(r => {
            const id = `${r.zone}-${r.row_num}-${r.col_num}`;
            let action = null;
            if (viewMode === 'after' && hasMaintenance) {
               action = maintRes.find(m => m.zone === r.zone && m.row_num === r.row_num && m.col_num === r.col_num);
            }

            let isPlugged = r.code === 'PLG';
            let depth = Number(r.size_val) || 0;
            let code = r.code || 'NDD';

            if (viewMode === 'after') {
              if (action) {
                if (action.action === 'PLG' || action.action === '塞管') isPlugged = true;
                else if (action.action === 'RPL' || action.action === '換管') {
                  isPlugged = false;
                  retubedMatMap.set(id, action.new_material || 'C7150T');
                }
              } else if (!hasMaintenance) {
                if (depth > 50) isPlugged = true;
                if (code === 'COR') isPlugged = true;
              }
            }

            if (isPlugged) {
              currentPluggedSet.add(id);
            }
          });
        }

        let d_c4430t = 0;
        let d_c7150t = 0;
        let d_block = 0;

        if (Array.isArray(tubesRes) && tubesRes.length > 0) {
          tubesRes.forEach((t: any) => {
            const id = `${t.zone}-${t.row_num}-${t.col_num}`;
            const isPlugged = currentPluggedSet.has(id);
            if (isPlugged) {
              d_block++;
            } else {
              let mat = t.material || '';
              let wasInstalledAfter = false;
              if (t.install_year) {
                if (t.install_year > currentYear) {
                  wasInstalledAfter = true;
                } else if (t.install_year === currentYear && viewMode === 'before') {
                  wasInstalledAfter = true;
                }
              }
              
              if (retubedMatMap.has(id)) {
                mat = retubedMatMap.get(id)!;
              } else if (wasInstalledAfter) {
                mat = 'C4430T'; // fallback for tubes replaced in the future
              }

              if (mat.includes('銅鎳') || mat.includes('C7150') || mat.includes('C7150T')) {
                d_c7150t++;
              } else if (mat.includes('黃銅') || mat.includes('C4430') || mat.includes('C4430T')) {
                d_c4430t++;
              } else {
                d_c4430t++; // Default
              }
            }
          });
        }

        setBaseC4430t(d_c4430t);
        setBaseC7150t(d_c7150t);
        setBasePlugged(d_block);

        setC4430t(d_c4430t);
        setC7150t(d_c7150t);
        setPlugged(d_block);
        setLoading(false);

      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    };

    fetchData();
  }, [unitId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  const totalTubes = 6312;
  const currentTotal = c4430t + c7150t + plugged;
  
  // 計算熱負荷
  const calcKo = (c4: number, c7: number) => (3219.18 * c4 + 2902.69 * c7) / totalTubes;
  const calcPercent = (ko: number) => (ko / 3197.02) * 100;
  const calcQ = (percent: number) => 110212708.6 * (percent / 100);
  const calcSteam = (percent: number) => 251759 * (percent / 100);

  const currentKo = calcKo(c4430t, c7150t);
  const currentPercent = calcPercent(currentKo);
  
  const baseKo = calcKo(baseC4430t, baseC7150t);
  const basePercent = calcPercent(baseKo);

  const handleReset = () => {
    setC4430t(baseC4430t);
    setC7150t(baseC7150t);
    setPlugged(basePlugged);
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Calculator className="text-blue-500" />
            熱負荷能力試算 ({unitId})
          </h2>
          <p className="text-xs text-slate-400 mt-1">維護處置前，可透過調整管束數量來模擬熱負荷能力的變化，並與原始設計或 MHI 建議值進行對比。</p>
        </div>
        <a 
          href="http://w56-web/Pages/?noteId=1777446768062qp87la6yc" 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-2 bg-blue-900/40 text-blue-300 hover:bg-blue-800/60 hover:text-white border border-blue-700/50 px-4 py-2 rounded-lg transition-colors text-sm font-medium shadow-sm"
        >
          <Info size={16} />
          原始計算書
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左側：輸入區 */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-sm flex flex-col">
          <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-800 pb-2">管束數量設定</h3>
          
          <div className="space-y-4 flex-1">
            <div>
              <label className="block text-sm font-medium text-amber-400 mb-1">有效 C4430T (黃銅管) 數量</label>
              <input 
                type="number" 
                value={c4430t} 
                onChange={(e) => setC4430t(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-medium"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-400 mb-1">有效 C7150T (銅鎳管) 數量</label>
              <input 
                type="number" 
                value={c7150t} 
                onChange={(e) => setC7150t(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-medium"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">塞管總數</label>
              <input 
                type="number" 
                value={plugged} 
                onChange={(e) => setPlugged(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-medium"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-between items-center">
            <span className={`text-sm ${currentTotal !== totalTubes ? 'text-rose-400 font-bold' : 'text-slate-400'}`}>
              總計: {currentTotal} 支 (設計值: {totalTubes} 支)
            </span>
            <button 
              onClick={handleReset}
              className="text-sm px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
            >
              帶入最後紀錄
            </button>
          </div>
        </div>

        {/* 右側：計算結果 */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 flex flex-col shadow-sm">
          <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-700 pb-2 mb-4">試算結果</h3>
          
          <div className="flex-1 flex flex-col justify-center gap-6">
            <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-rose-900/20 to-transparent pointer-events-none"></div>
              <p className="text-sm text-slate-400 mb-2 relative z-10">模擬熱負荷能力 (Percentage)</p>
              <div className="flex flex-col items-center gap-1 relative z-10">
                <span className="text-5xl font-bold text-rose-400">{currentPercent.toFixed(2)}%</span>
                {Math.abs(currentPercent - basePercent) > 0.01 && (
                  <span className={`text-sm font-medium ${currentPercent > basePercent ? 'text-emerald-400' : 'text-rose-500'}`}>
                    {currentPercent > basePercent ? '+' : ''}{(currentPercent - basePercent).toFixed(2)}% (與目前紀錄比)
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 text-center flex flex-col justify-center">
                <p className="text-xs text-slate-400 mb-1">總熱傳導率 (Ko)</p>
                <p className="text-xl font-bold text-blue-300">{currentKo.toFixed(2)}</p>
              </div>
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 text-center flex flex-col justify-center">
                <p className="text-xs text-slate-400 mb-1">熱負荷 (Q) Kcal/hr</p>
                <p className="text-xl font-bold text-emerald-300">{calcQ(currentPercent).toLocaleString(undefined, {maximumFractionDigits:1})}</p>
              </div>
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-700 text-center flex flex-col justify-center">
                <p className="text-xs text-slate-400 mb-1">可處理蒸氣量 (kg/hr)</p>
                <p className="text-xl font-bold text-amber-300">{calcSteam(currentPercent).toLocaleString(undefined, {maximumFractionDigits:0})}</p>
              </div>
            </div>
          </div>
          
          <div className="mt-4 p-3 bg-blue-950/30 rounded-lg text-xs text-blue-300/80 flex gap-2">
            <Info size={16} className="shrink-0 mt-0.5" />
            <p>本試算基於設計值 (Over Design 1.49%) 與對數平均溫差進行推估。在實際大修規劃中，若預計塞管，請相應減少有效管數以維持總管數總和為 6,312 支。</p>
          </div>
        </div>
      </div>

      {/* 下方：參考基準對比 */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-800 pb-3 mb-5 flex items-center gap-2">
          參考基準對比
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 設計值卡片 */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-5">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-700/50">
              <h4 className="font-bold text-blue-400">原始設計值 (100%)</h4>
              <span className="text-xs font-mono bg-blue-950/50 text-blue-300 px-2 py-1 rounded">Base Case</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">C4430T 管數</span><span className="font-medium text-slate-200">5,870 支</span></div>
              <div className="flex justify-between"><span className="text-slate-400">C7150T 管數</span><span className="font-medium text-slate-200">442 支</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Block (塞管)</span><span className="font-medium text-slate-200">0 支</span></div>
              <div className="h-px bg-slate-700/50 my-2"></div>
              <div className="flex justify-between"><span className="text-slate-400">熱負荷能力</span><span className="font-bold text-white">100.00%</span></div>
              <div className="flex justify-between"><span className="text-slate-400">總熱傳導率 (Ko)</span><span className="font-medium text-slate-200">3,197.02</span></div>
              <div className="flex justify-between"><span className="text-slate-400">熱負荷 (Q)</span><span className="font-medium text-slate-200">110,212,708.6</span></div>
              <div className="flex justify-between"><span className="text-slate-400">可處理蒸氣量</span><span className="font-bold text-amber-400">251,759 kg/hr</span></div>
            </div>
          </div>

          {/* MHI 建議卡片 */}
          <div className="bg-slate-800/40 border border-emerald-900/30 rounded-lg p-5">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-700/50">
              <h4 className="font-bold text-emerald-400">MHI 建議安全下限</h4>
              <span className="text-xs font-mono bg-emerald-950/50 text-emerald-300 px-2 py-1 rounded">Max 88 Plugged</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">C4430T 管數</span><span className="font-medium text-slate-200">5,782 支</span></div>
              <div className="flex justify-between"><span className="text-slate-400">C7150T 管數</span><span className="font-medium text-slate-200">442 支</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Block (塞管)</span><span className="font-medium text-rose-400">88 支</span></div>
              <div className="h-px bg-slate-700/50 my-2"></div>
              <div className="flex justify-between"><span className="text-slate-400">熱負荷能力</span><span className="font-bold text-emerald-400">98.60%</span></div>
              <div className="flex justify-between"><span className="text-slate-400">總熱傳導率 (Ko)</span><span className="font-medium text-slate-200">3,152.14</span></div>
              <div className="flex justify-between"><span className="text-slate-400">熱負荷 (Q)</span><span className="font-medium text-slate-200">108,665,504.6</span></div>
              <div className="flex justify-between"><span className="text-slate-400">可處理蒸氣量</span><span className="font-bold text-amber-400">248,225 kg/hr</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
