import React, { useMemo, useState, useEffect } from 'react';
import { Download, TrendingUp, AlertCircle, Loader2, CheckCircle2, ShieldAlert, HelpCircle, Info, Eye } from 'lucide-react';
import * as XLSX from 'xlsx';

interface TrendAnalysisProps {
  unitData: any;
  onApplyToVisual?: (ids: string[], sourceYear: number, baseYear: number) => void;
}

const ZONES = ['ALL', 'IL', 'IR', 'OL', 'OR'];

const DIST_BUCKETS = [
  { label: '減少 0~14.9%',          color: 'text-purple-400',  bg: 'bg-purple-900/30',  test: (r: number) => r < 0 && r > -15 },
  { label: '無變化或微成長 (0~10%)',  color: 'text-emerald-400', bg: 'bg-emerald-900/20', test: (r: number) => r >= 0 && r <= 10 },
  { label: '成長 10–20%',            color: 'text-yellow-400',  bg: 'bg-yellow-900/20',  test: (r: number) => r > 10 && r <= 20 },
  { label: '成長 20–40%',            color: 'text-orange-400',  bg: 'bg-orange-900/20',  test: (r: number) => r > 20 && r <= 40 },
  { label: '成長 >40%',              color: 'text-red-400',     bg: 'bg-red-900/20',     test: (r: number) => r > 40 },
];

export default function TrendAnalysis({ unitData, onApplyToVisual }: TrendAnalysisProps) {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [currentSelection, setCurrentSelection] = useState<string>('');
  const [previousSelection, setPreviousSelection] = useState<string>('');
  const [maintenanceYears, setMaintenanceYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [deltaData, setDeltaData] = useState<any[]>([]);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!unitData || !unitData.unit_id) return;
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}api/years?unit_id=${unitData.unit_id}`).then(res => res.json()),
      fetch(`${import.meta.env.BASE_URL}api/maintenance/years?unit_id=${unitData.unit_id}`).then(res => res.json())
    ])
      .then(([years, mainYears]) => {
        if (Array.isArray(years) && years.length > 0) {
          const sorted = years.sort((a, b) => b - a);
          const availableMainYears = Array.isArray(mainYears) ? mainYears : [];
          setAvailableYears(sorted);
          setMaintenanceYears(availableMainYears);
          const defaultCurrMode = availableMainYears.includes(sorted[0]) ? 'after' : 'before';
          setCurrentSelection(`${sorted[0]}-${defaultCurrMode}`);
          
          let prevYear = sorted.length > 1 ? sorted[1] : sorted[0];
          const defaultPrevMode = availableMainYears.includes(prevYear) ? 'after' : 'before';
          setPreviousSelection(`${prevYear}-${defaultPrevMode}`);
        } else {
          setAvailableYears([]); setMaintenanceYears([]);
          setCurrentSelection(''); setPreviousSelection(''); setDeltaData([]);
        }
      })
      .catch(console.error);
  }, [unitData]);

  const fetchStateData = async (selection: string, unitId: string) => {
    const [year, mode] = selection.split('-');
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
        let code = r.code || 'NDD';
        let notes = r.notes || '';
        if (mode === 'after') {
          const mainAction = maintenanceRes.find(m => m.zone === r.zone && m.row_num === r.row_num && m.col_num === r.col_num);
          if (mainAction) {
            if (mainAction.action === 'PLG' || mainAction.action === '塞管') { isPlugged = true; }
            else if (mainAction.action === 'RPL' || mainAction.action === '換管') { isPlugged = false; isReplaced = true; depth = 0; code = 'NDD'; }
            if (mainAction.notes) notes = mainAction.notes;
          } else if (maintenanceRes.length === 0) {
            if (depth > 50) isPlugged = true;
            if (code === 'COR') isPlugged = true;
          }
        }
        map.set(id, { id, zone: r.zone, depth, isPlugged, isReplaced, code, notes });
      });
    }
    return map;
  };

  useEffect(() => {
    if (!currentSelection || !previousSelection || !unitData.unit_id) { setDeltaData([]); return; }
    setLoading(true);
    Promise.all([
      fetchStateData(currentSelection, unitData.unit_id),
      fetchStateData(previousSelection, unitData.unit_id)
    ]).then(([currMap, prevMap]) => {
      const deltas: any[] = [];
      currMap.forEach((curr, id) => {
        const prev = prevMap.get(id);
        if (!prev) return;
        let thinningRate = 0;
        let isAnomaly = false;
        let anomalyType = '';
        let anomalyReason = '';

        if (prev.isPlugged && !curr.isPlugged) {
          // 塞子遺失：任何模式都成立
          isAnomaly = true; anomalyType = 'missing_plug';
          anomalyReason = '基準為已塞管，但本次卻未顯示為塞管 (塞子遺失)';
        } else if (prev.isReplaced && curr.isPlugged) {
          // 換管後立刻塞管（基準為 AFTER 且處置為 RPL 才會觸發）
          isAnomaly = true; anomalyType = 'sudden_plug';
          anomalyReason = '基準為新換管，但本次立刻判定為塞管 (換管後立刻塞管)';
          thinningRate = 100 - prev.depth;
        } else if (prev.isPlugged && curr.isPlugged) {
          return; // 上下次皆塞，略過
        } else if (!prev.isPlugged && curr.isPlugged) {
          // 突現塞管：基準未塞→本次有塞，BEFORE / AFTER 皆視為異常
          isAnomaly = true; anomalyType = 'sudden_plug';
          thinningRate = 100 - prev.depth;
          anomalyReason = `基準未塞管 (${prev.depth.toFixed(1)}%)，本次已判定為塞管 (突現塞管)`;
        } else {
          thinningRate = curr.depth - prev.depth;
        }

        // 瑕疵率異常降低（非邏輯異常，但數值異常下降）
        if (!isAnomaly && thinningRate <= -15) {
          anomalyType = 'abnormal_decrease';
        }

        deltas.push({
          id, quadrant: curr.zone,
          prevDepth: prev.depth,
          currentDepth: curr.isPlugged ? 100 : curr.depth,
          status: curr.isPlugged ? 'Plugged' : 'Normal',
          thinningRate, defectType: curr.code,
          notes: curr.notes || prev.notes || '',
          isAnomaly, anomalyType, anomalyReason
        });
      });
      setDeltaData(deltas.sort((a, b) => b.thinningRate - a.thinningRate));
    })
    .catch(console.error)
    .finally(() => setLoading(false));
  }, [currentSelection, previousSelection, unitData]);

  // 計算每個象限的統計資料
  const zoneStats = useMemo(() => {
    return ZONES.map(zone => {
      const zoneData = zone === 'ALL' ? deltaData : deltaData.filter(d => d.quadrant === zone);
      const normalData = zoneData.filter(d => !d.isAnomaly);

      const dist = DIST_BUCKETS.map(b => ({
        ...b,
        count: normalData.filter(d => b.test(d.thinningRate)).length
      }));

      const missingPlug = zoneData.filter(d => d.anomalyType === 'missing_plug').length;
      const suddenPlug = zoneData.filter(d => d.anomalyType === 'sudden_plug').length;
      const abnormalDecrease = zoneData.filter(d => d.anomalyType === 'abnormal_decrease').length;
      const totalAnomalies = missingPlug + suddenPlug + abnormalDecrease;

      return { zone, dist, missingPlug, suddenPlug, abnormalDecrease, totalAnomalies, total: zoneData.length };
    });
  }, [deltaData]);

  const totalAnomalies = useMemo(() => deltaData.filter(d => d.isAnomaly || d.anomalyType === 'abnormal_decrease').length, [deltaData]);

  const labelStr = (sel: string) => {
    const [y, m] = sel.split('-');
    return `${y} (${m === 'after' ? '大修後' : '檢測基準'})`;
  };

  const handleExportDelta = () => {
    if (deltaData.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(deltaData.map(d => {
      const [zone, row, col] = d.id.split('-');
      return {
        '區域': zone, 'ROW': row, 'COL': col,
        [`${labelStr(previousSelection)} 深度 (%)`]: d.prevDepth.toFixed(2),
        [`${labelStr(currentSelection)} 深度 (%)`]: d.status === 'Normal' ? d.currentDepth.toFixed(2) : '已塞管',
        '狀態': d.isAnomaly ? '邏輯異常' : d.status === 'Plugged' ? '已塞管' : '正常',
        '成長率 (%)': d.isAnomaly ? d.anomalyReason : d.thinningRate.toFixed(2),
        '缺陷類型': d.defectType,
        '備註': d.notes
      };
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Delta View');
    XLSX.writeFile(wb, `Condenser_Delta_${previousSelection}_to_${currentSelection}.xlsx`);
  };

  const handleExportAnomalies = () => {
    const anomalies = deltaData.filter(d => d.isAnomaly || d.anomalyType === 'abnormal_decrease');
    if (anomalies.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(anomalies.map(d => {
      const [zone, row, col] = d.id.split('-');
      return {
        '區域': zone, 'ROW': row, 'COL': col,
        '基準深度 (%)': d.prevDepth.toFixed(2),
        '本次深度 (%)': d.status === 'Normal' ? d.currentDepth.toFixed(2) : '已塞管',
        '成長率 (%)': d.thinningRate.toFixed(2),
        '異常類型': d.anomalyType === 'missing_plug' ? '塞子遺失' : d.anomalyType === 'sudden_plug' ? '突現塞管' : '瑕疵率異常降低',
        '異常說明': d.anomalyReason || `瑕疵率下降 ${Math.abs(d.thinningRate).toFixed(1)}%`
      };
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '異常報告');
    XLSX.writeFile(wb, `Condenser_Anomaly_${previousSelection}_to_${currentSelection}.xlsx`);
  };

  const handleViewInCanvas = () => {
    if (!onApplyToVisual || totalAnomalies === 0) return;
    const anomalyIds = deltaData.filter(d => d.isAnomaly || d.anomalyType === 'abnormal_decrease').map(d => d.id);
    const [currentYear] = currentSelection.split('-');
    const [prevYear] = previousSelection.split('-');
    onApplyToVisual(anomalyIds, Number(currentYear), Number(prevYear));
  };

  if (availableYears.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-slate-900 rounded-xl border border-slate-800 text-slate-400">
        <TrendingUp size={48} className="mb-4 text-slate-600" />
        <h3 className="text-lg font-medium text-white mb-2">無法進行多期比對</h3>
        <p>此機組目前只有 {availableYears.length} 筆年份資料，多期比對至少需要 2 個年份的檢測紀錄。</p>
        <p className="mt-2 text-sm text-slate-500">請前往「資料匯入」上傳更多年份的資料。</p>
      </div>
    );
  }

  const YearSelector = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-slate-300">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-1.5 text-sm focus:ring-blue-500 focus:border-blue-500 font-medium"
      >
        {availableYears.map(y => (
          <optgroup key={y} label={`${y} 年份`}>
            {maintenanceYears.includes(y) && <option value={`${y}-after`}>{y} (大修處理後)</option>}
            <option value={`${y}-before`}>{y} (大修檢測基準)</option>
          </optgroup>
        ))}
      </select>
    </div>
  );

  const AnomalyRow = ({ label, count }: { label: string; count: number }) => (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-slate-800/50">
      <span className="text-xs text-slate-400">{label}</span>
      {count === 0 ? (
        <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
          <CheckCircle2 size={12} /> 0
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-orange-400 font-bold">
          <ShieldAlert size={12} /> {count}
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white">瑕疵深度比對 (Delta Analysis)</h2>
          <p className="text-slate-400 mt-1">差異比對與象限分布統計</p>
        </div>
        <div className="flex items-center gap-3">
          {onApplyToVisual && (
            <button
              onClick={handleViewInCanvas}
              disabled={totalAnomalies === 0 || loading}
              title={totalAnomalies === 0 ? '目前無異常記錄' : '在動態視覺檢視中凸顯異常管束'}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Eye size={16} />
              <span>在視覺中凸顯 ({totalAnomalies})</span>
            </button>
          )}
          <button
            onClick={handleExportAnomalies}
            disabled={totalAnomalies === 0 || loading}
            title={totalAnomalies === 0 ? '目前無異常記錄' : '下載異常管報告'}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-500 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ShieldAlert size={16} />
            <span>下載異常報告 ({totalAnomalies})</span>
          </button>
          <button
            onClick={handleExportDelta}
            disabled={deltaData.length === 0 || loading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={18} />
            <span>下載比對結果 (Excel)</span>
          </button>
        </div>
      </div>

      {/* Year Selector */}
      <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 relative">
        {loading && (
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-10 rounded-xl">
            <Loader2 className="animate-spin text-blue-500" size={32} />
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <YearSelector label="本次比對狀態:" value={currentSelection} onChange={setCurrentSelection} />
            <div className="text-slate-500 font-bold px-4 py-1 bg-slate-800/50 rounded-lg">VS</div>
            <YearSelector label="基準比對狀態:" value={previousSelection} onChange={setPreviousSelection} />
          </div>
          
          <button 
            onClick={() => setShowHelp(!showHelp)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all duration-200 shadow-sm ${
              showHelp 
                ? 'bg-blue-600 text-white shadow-blue-900/50' 
                : 'bg-blue-500/20 text-blue-400 border border-blue-500/40 hover:bg-blue-500/30 hover:border-blue-500/60 hover:text-blue-300'
            }`}
            title="查看比對模式說明"
          >
            <HelpCircle size={18} />
            <span>比對模式說明</span>
          </button>
        </div>
      </div>

      {/* Help Card */}
      {showHelp && (
        <div className="bg-blue-900/20 border border-blue-800/60 rounded-xl p-4 text-blue-100 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
          <Info className="w-5 h-5 mt-0.5 text-blue-400 flex-shrink-0" />
          <div className="space-y-2 text-sm leading-relaxed">
            <p className="font-bold text-blue-300 text-base">比對模式意義說明</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <span className="font-semibold text-blue-200">跨年運轉比對（本次「大修檢測基準」 VS 前次「大修處置後」）：</span>
                <br />
                代表 <span className="text-white bg-blue-900/40 px-1 rounded">上次大修起機後，到本次大修停機檢測期間</span> 設備因為實際運轉所產生的管束劣化差異。
              </li>
              <li>
                <span className="font-semibold text-blue-200">同年維修比對（同年「大修處置後」 VS 同年「大修檢測基準」）：</span>
                <br />
                代表 <span className="text-white bg-blue-900/40 px-1 rounded">本次大修期間所執行的實際維修成果</span>。
                在此模式下：
                <ul className="list-[circle] pl-5 mt-1 text-blue-200/80 space-y-0.5">
                  <li>「突現塞管」的數量：即等於本次維修的 <strong>塞管數量</strong>。</li>
                  <li>「減少 0~14.9%」加上「瑕疵率異常降低 (≥15%)」的總和：即等於本次維修的 <strong>換管數量</strong>。</li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Zone Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {zoneStats.map(({ zone, dist, missingPlug, suddenPlug, abnormalDecrease, totalAnomalies: zoneAnomaly, total }) => (
          <div
            key={zone}
            className={`bg-slate-900 rounded-xl ${
              zone === 'ALL'
                ? 'border-2 border-blue-700/60 shadow-[0_0_15px_rgba(59,130,246,0.15)]'
                : `border ${zoneAnomaly > 0 ? 'border-orange-900/60' : 'border-slate-800'}`
            } p-4 flex flex-col gap-3`}
          >
            {/* Zone Header */}
            <div className="flex items-start justify-between gap-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`${zone === 'ALL' ? 'text-base' : 'text-lg'} font-bold text-white px-2 py-0.5 rounded-lg whitespace-nowrap ${zone === 'ALL' ? 'bg-blue-900 border border-blue-700 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'bg-slate-800'}`}>
                  {zone === 'ALL' ? '合計' : zone}
                </span>
                <span className="text-[10px] text-slate-500 whitespace-nowrap">共 {total} 支</span>
              </div>
              {zoneAnomaly > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-orange-400 font-bold bg-orange-900/30 px-1.5 py-0.5 rounded-md border border-orange-900/40 whitespace-nowrap flex-shrink-0">
                  <AlertCircle size={10} /> {zoneAnomaly} 異常
                </span>
              )}
            </div>

            {/* Distribution */}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">📊 瑕疵成長分布</p>
              {dist.map(b => (
                <div key={b.label} className={`flex items-center justify-between px-2 py-1 rounded ${b.count > 0 ? b.bg : ''}`}>
                  <span className="text-xs text-slate-400">{b.label}</span>
                  <span className={`text-xs font-bold tabular-nums ${b.count > 0 ? b.color : 'text-slate-600'}`}>
                    {b.count} 支
                    <span className="font-normal text-slate-500 ml-1">
                      ({total > 0 ? (b.count / total * 100).toFixed(2) : '0.00'}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="border-t border-slate-800" />

            {/* Anomaly Checks */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">🔍 異常檢查</p>
              <AnomalyRow label="塞子遺失" count={missingPlug} />
              <AnomalyRow label="突現塞管" count={suddenPlug} />
              <AnomalyRow label="瑕疵率異常降低 (≥15%)" count={abnormalDecrease} />
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {!loading && deltaData.length === 0 && (
        <div className="text-center py-12 text-slate-500 bg-slate-900 rounded-xl border border-slate-800">
          請選擇比對年份以顯示分析結果
        </div>
      )}
    </div>
  );
}
