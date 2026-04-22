import React, { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, CheckCircle, XCircle, Clock, Loader2, X, Info, Play, Pause, SkipBack, SkipForward } from 'lucide-react';

interface DashboardProps {
  unitData: any;
}

interface RulDetail {
  latestYear: number;
  prevYear: number;
  prevYearSource: '大修處置結果' | '檢測紀錄（無處置資料）';
  effectiveDiff: number;
  validTubeCount: number;
  thinningTubeCount: number;
  avgDepth: number;
  avgThinningRate: number;
  rul: number;
  representativeness: number; // (thinningTubeCount / totalTubes) * 100
}

interface ZoneStat {
  plugged: number;
  retubed: number;
  warning: number;
  normal: number;
  total: number;
}

export default function Dashboard({ unitData }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [latestYear, setLatestYear] = useState(0);
  const [stats, setStats] = useState({ plugged: 0, retubed: 0, normal: 0, warning: 0, avgThinningRate: 0, rul: 0 });
  const [zoneStats, setZoneStats] = useState<Record<string, ZoneStat>>({
    IL: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
    IR: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
    OL: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
    OR: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
  });
  const [rulDetail, setRulDetail] = useState<RulDetail | null>(null);
  const [showRulModal, setShowRulModal] = useState(false);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [maintenanceYears, setMaintenanceYears] = useState<number[]>([]);
  const [currentYearIndex, setCurrentYearIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'before' | 'after'>('before');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playStepIndex, setPlayStepIndex] = useState(0);

  const totalTubes = 6312;

  const playSteps = useMemo(() => {
    const steps: Array<{ yi: number; vm: 'before' | 'after' }> = [];
    availableYears.forEach((year, yi) => {
      steps.push({ yi, vm: 'before' });
      if (maintenanceYears.includes(year)) {
        steps.push({ yi, vm: 'after' });
      }
    });
    return steps;
  }, [availableYears, maintenanceYears]);

  useEffect(() => {
    let interval: number;
    if (isPlaying && playSteps.length > 0) {
      interval = window.setInterval(() => {
        setPlayStepIndex((prev) => {
          const next = prev + 1;
          if (next >= playSteps.length) {
            setIsPlaying(false);
            return prev;
          }
          setCurrentYearIndex(playSteps[next].yi);
          setViewMode(playSteps[next].vm);
          return next;
        });
      }, 2500);
    }
    return () => {
      if (interval) clearInterval(interval);
    }
  }, [isPlaying, playSteps]);

  useEffect(() => {
    if (!unitData?.unit_id) return;
    setLoading(true);
    setAvailableYears([]);
    setMaintenanceYears([]);

    fetch(`${import.meta.env.BASE_URL}api/years?unit_id=${unitData.unit_id}`)
      .then(r => r.json())
      .then(async (years) => {
        if (!Array.isArray(years) || years.length === 0) {
          setLoading(false);
          return;
        }

        const sortedYears = years.sort((a, b) => a - b);
        setAvailableYears(sortedYears);

        const mYears = await fetch(`${import.meta.env.BASE_URL}api/maintenance/years?unit_id=${unitData.unit_id}`).then(r => r.json());
        const maintArr = Array.isArray(mYears) ? mYears : [];
        setMaintenanceYears(maintArr);

        let totalSteps = sortedYears.length;
        maintArr.forEach(y => { if (sortedYears.includes(y)) totalSteps++; });
        
        const lastYear = sortedYears[sortedYears.length - 1];
        const hasMaint = maintArr.includes(lastYear);

        setPlayStepIndex(totalSteps - 1);
        setCurrentYearIndex(sortedYears.length - 1);
        setViewMode(hasMaint ? 'after' : 'before');
      })
      .catch(err => { console.error(err); setLoading(false); });
  }, [unitData]);

  useEffect(() => {
    if (availableYears.length === 0 || currentYearIndex < 0 || currentYearIndex >= availableYears.length) return;
    
    setLoading(true);
    const currentYear = availableYears[currentYearIndex];
    setLatestYear(currentYear);
    
    setStats({ plugged: 0, retubed: 0, normal: 0, warning: 0, avgThinningRate: 0, rul: 0 });
    setZoneStats({
      IL: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
      IR: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
      OL: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
      OR: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
    });
    setRulDetail(null);

    Promise.all([
      fetch(`${import.meta.env.BASE_URL}api/records?unit_id=${unitData.unit_id}&year=${currentYear}`).then(r => r.json()),
      fetch(`${import.meta.env.BASE_URL}api/maintenance?unit_id=${unitData.unit_id}&year=${currentYear}`).then(r => r.json()),
    ]).then(async ([recordsRes, maintRes]) => {

      // 前一年資料：優先用大修處置結果，無則退回檢測紀錄
      let prevRecordsRes: any[] = [];
      let prevMaintRes: any[] = [];
      let effectiveDiff = 1;
      let prevYear = 0;
      
      if (currentYearIndex > 0) {
        prevYear = availableYears[currentYearIndex - 1];
        effectiveDiff = currentYear - prevYear;
        [prevRecordsRes, prevMaintRes] = await Promise.all([
          fetch(`${import.meta.env.BASE_URL}api/records?unit_id=${unitData.unit_id}&year=${prevYear}`).then(r => r.json()),
          fetch(`${import.meta.env.BASE_URL}api/maintenance?unit_id=${unitData.unit_id}&year=${prevYear}`).then(r => r.json()),
        ]);
      }

      // 建立前一年起始深度 Map（優先用處置結果）
      const prevMap = new Map<string, { isPlugged: boolean; depth: number }>();
      if (Array.isArray(prevRecordsRes)) {
        prevRecordsRes.forEach(r => {
          const code = r.code || 'NDD';
          prevMap.set(`${r.zone}-${r.row_num}-${r.col_num}`, {
            isPlugged: code === 'PLG',
            depth: Number(r.size_val) || 0,
          });
        });
      }
      const hasPrevMaint = Array.isArray(prevMaintRes) && prevMaintRes.length > 0;
      if (hasPrevMaint) {
        prevMaintRes.forEach(m => {
          const key = `${m.zone}-${m.row_num}-${m.col_num}`;
          const existing = prevMap.get(key);
          if (m.action === 'RPL' || m.action === '換管') {
            // 換管：新管，起始深度歸零
            prevMap.set(key, { isPlugged: false, depth: 0 });
          } else if (m.action === 'PLG' || m.action === '塞管') {
            // 塞管：排除減薄率計算
            prevMap.set(key, { isPlugged: true, depth: existing?.depth ?? 0 });
          }
        });
      }
      const prevYearSource: RulDetail['prevYearSource'] = hasPrevMaint ? '大修處置結果' : '檢測紀錄（無處置資料）';

      // 統計
      let plugged = 0, retubed = 0, normal = 0, warning = 0;
      let totalThinningRate = 0, thinningCount = 0;
      let validDepthSum = 0, validDepthCount = 0;

      const zStats: Record<string, ZoneStat> = {
        IL: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
        IR: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
        OL: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
        OR: { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 },
      };

      if (Array.isArray(recordsRes)) {
        const hasMaintenance = Array.isArray(maintRes) && maintRes.length > 0;

        recordsRes.forEach(r => {
          const id = `${r.zone}-${r.row_num}-${r.col_num}`;
          let action = null;
          if (viewMode === 'after' && hasMaintenance) {
             action = maintRes.find(m => m.zone === r.zone && m.row_num === r.row_num && m.col_num === r.col_num);
          }

          let isPlugged = r.code === 'PLG';
          let isRetubed = false;
          let depth = Number(r.size_val) || 0;
          let code = r.code || 'NDD';

          if (viewMode === 'after') {
            if (action) {
              if (action.action === 'PLG' || action.action === '塞管') isPlugged = true;
              else if (action.action === 'RPL' || action.action === '換管') { isPlugged = false; isRetubed = true; depth = 0; code = 'NDD'; }
            } else if (!hasMaintenance) {
              if (depth > 50) isPlugged = true;
              if (code === 'COR') isPlugged = true;
            }
          }

          if (zStats[r.zone]) zStats[r.zone].total++;

          if (isPlugged) {
            plugged++;
            if (zStats[r.zone]) zStats[r.zone].plugged++;
          } else if (isRetubed) {
            retubed++;
            if (zStats[r.zone]) zStats[r.zone].retubed++;
          } else {
            normal++;
            if (depth >= 40) { warning++; if (zStats[r.zone]) zStats[r.zone].warning++; }
            else { if (zStats[r.zone]) zStats[r.zone].normal++; }
            validDepthSum += depth;
            validDepthCount++;

            const prev = prevMap.get(id);
            if (prev && !prev.isPlugged && prev.depth <= depth) {
              const rate = (depth - prev.depth) / effectiveDiff;
              if (rate > 0) { totalThinningRate += rate; thinningCount++; }
            }
          }
        });
      }

      const avgThinningRate = thinningCount > 0 ? totalThinningRate / thinningCount : 0;
      const avgDepth = validDepthCount > 0 ? validDepthSum / validDepthCount : 0;
      // 更換門檻設為 60%（壁厚損耗達 60% 即需更換）
      const REPLACE_THRESHOLD = 60;
      const rul = avgThinningRate > 0 ? (REPLACE_THRESHOLD - avgDepth) / avgThinningRate : 99;
      const representativeness = (thinningCount / totalTubes) * 100;

      setStats({ plugged, retubed, normal, warning, avgThinningRate, rul });
      setZoneStats(zStats);
      setRulDetail({
        latestYear: currentYear,
        prevYear,
        prevYearSource,
        effectiveDiff,
        validTubeCount: validDepthCount,
        thinningTubeCount: thinningCount,
        avgDepth,
        avgThinningRate,
        rul,
        representativeness,
      });
      setLoading(false);
    }).catch(err => { console.error(err); setLoading(false); });
  }, [unitData, currentYearIndex, viewMode, availableYears]);

  if (loading && availableYears.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <h3 className="text-xl font-bold text-slate-300">資料計算中...</h3>
      </div>
    );
  }

  const pluggingRatio = (stats.plugged / totalTubes) * 100;
  const isPluggingWarning = pluggingRatio > 8;
  const totalNonPlugged = stats.normal + stats.retubed;

  return (
    <div className="space-y-3 relative">
      {/* 載入中遮罩（切換年份時） */}
      {loading && availableYears.length > 0 && (
        <div className="absolute inset-0 z-50 bg-slate-950/40 backdrop-blur-[1px] flex items-center justify-center rounded-2xl">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}
      
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">總覽儀表板 - {unitData.name}</h2>
          <p className="text-xs text-slate-400 mt-1">
            總管數: {totalTubes.toLocaleString()}
          </p>
        </div>

        {/* Timeline Bar */}
        {availableYears.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 pt-2.5 pb-7 px-3 rounded-xl flex items-center gap-3 shadow-sm flex-1 max-w-[850px]">
          <div className="flex items-center gap-1">
            <button 
              onClick={() => {
                setIsPlaying(false);
                setPlayStepIndex(0);
                setCurrentYearIndex(playSteps[0]?.yi ?? 0);
                setViewMode(playSteps[0]?.vm ?? 'before');
              }}
              className="p-2 text-slate-400 hover:bg-slate-800 rounded-full transition-colors disabled:opacity-50"
              disabled={playSteps.length === 0}
            >
              <SkipBack size={20} />
            </button>
            <button 
              onClick={() => {
                if (playStepIndex >= playSteps.length - 1) {
                  setPlayStepIndex(0);
                  setCurrentYearIndex(playSteps[0]?.yi ?? 0);
                  setViewMode(playSteps[0]?.vm ?? 'before');
                }
                setIsPlaying(!isPlaying);
              }}
              className="p-2 bg-blue-600 text-white hover:bg-blue-700 rounded-full transition-colors shadow-sm disabled:opacity-50"
              disabled={playSteps.length === 0}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-1" />}
            </button>
            <button 
              onClick={() => {
                setIsPlaying(false);
                const last = playSteps.length - 1;
                if (last >= 0) {
                  setPlayStepIndex(last);
                  setCurrentYearIndex(playSteps[last].yi);
                  setViewMode(playSteps[last].vm);
                }
              }}
              className="p-2 text-slate-400 hover:bg-slate-800 rounded-full transition-colors disabled:opacity-50"
              disabled={playSteps.length === 0}
            >
              <SkipForward size={20} />
            </button>
          </div>

          <div className="flex-1 px-4">
            <div className="relative flex items-center justify-between">
              <div className="absolute left-0 h-1 bg-slate-800 rounded-full top-[8px] z-0 right-0"></div>
              {playSteps.map((step, si) => {
                const year = availableYears[step.yi];
                const isActive = si === playStepIndex;
                const isPast = si < playStepIndex;
                const isBefore = step.vm === 'before';
                
                return (
                  <div
                    key={`${year}-${step.vm}`}
                    className="relative z-10 flex flex-col items-center cursor-pointer group"
                    onClick={() => {
                      setIsPlaying(false);
                      setPlayStepIndex(si);
                      setCurrentYearIndex(step.yi);
                      setViewMode(step.vm);
                    }}
                  >
                    <div className={`relative z-10 w-3 h-3 rounded-full border-2 transition-all duration-200 ${
                      isActive
                        ? (isBefore ? 'bg-blue-500 border-blue-400 scale-125 shadow-[0_0_8px_rgba(59,130,246,0.7)]' : 'bg-emerald-500 border-emerald-400 scale-125 shadow-[0_0_8px_rgba(16,185,129,0.7)]')
                        : isPast
                          ? (isBefore ? 'bg-blue-900 border-blue-700' : 'bg-emerald-900 border-emerald-700')
                          : 'bg-slate-800 border-slate-600 group-hover:border-blue-500'
                    }`}></div>
                    <div className="absolute top-5 flex flex-col items-center gap-0.5">
                      {isBefore && (
                        <span className={`text-[10px] font-bold whitespace-nowrap ${
                          isActive ? 'text-blue-300' : isPast ? 'text-slate-500' : 'text-slate-600'
                        }`}>{year}</span>
                      )}
                      <span className={`text-[9px] whitespace-nowrap px-1 py-0.5 rounded-full font-medium ${
                        isActive
                          ? (isBefore ? 'bg-blue-900/60 text-blue-300' : 'bg-emerald-900/60 text-emerald-300')
                          : isPast
                            ? 'text-slate-600'
                            : 'text-slate-700'
                      }`}>
                        {isBefore ? '大修檢測' : '大修處置'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-right min-w-[90px] pl-2 border-l border-slate-700">
            <div className="text-[10px] text-slate-400">目前檢視</div>
            <div className="text-lg font-bold text-white leading-tight">{latestYear || '----'}</div>
            <div className={`text-[9px] font-medium ${
              viewMode === 'before' ? 'text-blue-400' : 'text-emerald-400'
            }`}>
              {viewMode === 'before' ? '檢測記錄' : '處置結果'}
            </div>
          </div>
        </div>
      )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
        <KpiCard
          title="總塞管率 (Plugging Ratio)"
          value={`${pluggingRatio.toFixed(2)}%`}
          subtitle="原廠設計餘裕: 10%"
          icon={isPluggingWarning ? <AlertTriangle className="text-red-500" /> : <CheckCircle className="text-emerald-500" />}
          alert={isPluggingWarning}
        />
        <KpiCard
          title="預期剩餘壽命 (RUL)"
          value={stats.rul > 0 ? `${stats.rul.toFixed(1)} 年` : '-- 年'}
          subtitle={`平均減薄率: ${stats.avgThinningRate.toFixed(2)}% / 年`}
          badge={rulDetail ? `代表性 ${rulDetail.representativeness.toFixed(1)}%` : undefined}
          icon={<Clock className="text-blue-500" />}
          onClick={() => rulDetail && setShowRulModal(true)}
          clickable
        />
        <KpiCard
          title="已塞管數量"
          value={stats.plugged.toLocaleString()}
          subtitle="需持續追蹤"
          icon={<XCircle className="text-slate-400" />}
        />
        <KpiCard
          title="劣化警示 (>=40%)"
          value={stats.warning.toLocaleString()}
          subtitle="建議下次大修處理"
          icon={<AlertTriangle className="text-amber-500" />}
        />
      </div>

      {/* 整合：管束狀態分布 + 區域熱交換惡化評估 */}
      <div className="bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-800">
        <h3 className="text-base font-semibold text-slate-100 mb-3">區域管束狀態分布與惡化評估</h3>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* 左側 4 區小卡，佔 2/3 寬度 */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {['OL', 'OR', 'IL', 'IR'].map(zone => {
              const z = zoneStats[zone] || { plugged: 0, retubed: 0, warning: 0, normal: 0, total: 0 };
              const ratio = z.total > 0 ? (z.plugged / z.total) * 100 : 0;
              const color = ratio > 10 ? 'text-red-400' : ratio > 5 ? 'text-amber-400' : 'text-emerald-400';
              return (
                <div key={zone} className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50 flex items-center justify-between gap-3">
                  <div className="flex flex-col text-left">
                    <h4 className="text-lg font-bold text-slate-200">{zone} 區域</h4>
                    <p className="text-xs text-slate-400 mt-0.5">共 {z.total} 支</p>
                    <div className="mt-1.5 bg-slate-900/50 px-2 py-1 rounded-lg border border-slate-700/50">
                      <span className="text-[10px] text-slate-400">塞管率 </span>
                      <span className={`text-xs font-bold ${color}`}>{ratio.toFixed(1)}%</span>
                    </div>
                  </div>
                  <DonutChart
                    normal={z.normal}
                    warning={z.warning}
                    plugged={z.plugged}
                    retubed={z.retubed}
                    total={z.total || 1}
                    size={70}
                    strokeWidth={8}
                    innerText={`${ratio.toFixed(1)}%`}
                  />
                </div>
              );
            })}
          </div>

          {/* 右側 全廠總覽大卡，佔 1/3 寬度 */}
          <div className="lg:col-span-1 bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex flex-col items-center justify-center relative min-h-[160px]">
            <div className="absolute top-3 left-4 w-full pr-8 flex justify-between items-center">
              <h4 className="text-base font-bold text-slate-200">全廠總覽</h4>
              <span className="text-[10px] text-slate-400">總塞管率: <span className={isPluggingWarning ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>{pluggingRatio.toFixed(1)}%</span></span>
            </div>
            
            <div className="mt-6 mb-3 flex-1 flex items-center justify-center">
              <DonutChart
                normal={stats.normal - stats.warning}
                warning={stats.warning}
                plugged={stats.plugged}
                retubed={stats.retubed}
                total={totalTubes}
                size={120}
                strokeWidth={12}
                innerText={`${pluggingRatio.toFixed(1)}%`}
                subText="總塞管率"
              />
            </div>
            <StatusLegend />
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mt-2">
          * 若單一區域塞管率過高，可能導致局部流速增加，加速周圍管束劣化。
        </p>
      </div>

      {/* RUL 計算步驟 Modal */}
      {showRulModal && rulDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowRulModal(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-5xl mx-4 p-6 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowRulModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors">
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-blue-900/40 rounded-lg"><Clock className="text-blue-400" size={20} /></div>
              <div>
                <h3 className="text-lg font-bold text-white">預期剩餘壽命 (RUL) 計算步驟</h3>
                <p className="text-xs text-slate-400">Remaining Useful Life — 線性減薄速率推估法</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <Step n={1} title="確認計算區間">
                <p>最新大修：<b className="text-blue-300">{rulDetail.latestYear} 年</b></p>
                <p>前一大修：<b className="text-blue-300">{rulDetail.prevYear > 0 ? `${rulDetail.prevYear} 年` : '無'}</b></p>
                <p>年份差：<b className="text-white">{rulDetail.effectiveDiff} 年</b></p>
                <Tag>{rulDetail.prevYear > 0 ? `前年來源：${rulDetail.prevYearSource}` : '僅一年資料'}</Tag>
              </Step>

              <Step n={2} title="各管年減薄速率">
                <code className="block mt-1 bg-slate-800 rounded px-2 py-1.5 text-emerald-300 text-[10px] break-all">
                  (最新深度% − 前年起始深度%) ÷ {rulDetail.effectiveDiff} 年
                </code>
                <p className="mt-2 text-[10px] text-slate-400">條件：前年未塞管、深度未減少</p>
                <Tag>參與管數：{rulDetail.thinningTubeCount.toLocaleString()} 支</Tag>
              </Step>

              <Step n={3} title="全廠平均減薄率">
                <code className="block bg-slate-800 rounded px-2 py-1.5 text-emerald-300 text-[10px] break-all">
                  Σ(各管減薄速率) ÷ {rulDetail.thinningTubeCount.toLocaleString()} 支
                </code>
                <p className="mt-2 text-xs">結果：<b className="text-amber-300">{rulDetail.avgThinningRate.toFixed(3)} % / 年</b></p>
              </Step>

              <Step n={4} title="平均當前深度">
                <p className="text-[10px] text-slate-400">所有正常運行管子的平均壁厚損耗：</p>
                <p className="mt-2"><b className="text-amber-300 text-lg">{rulDetail.avgDepth.toFixed(2)} %</b></p>
              </Step>

              <Step n={5} title="推估剩餘壽命">
                <code className="block bg-slate-800 rounded px-2 py-1.5 text-emerald-300 text-[10px] break-all">
                  (60% − {rulDetail.avgDepth.toFixed(2)}%) ÷ {rulDetail.avgThinningRate.toFixed(3)}%/年
                </code>
                <p className="mt-2">= <b className="text-blue-300 text-xl">{rulDetail.rul.toFixed(1)} 年</b></p>
                <Tag>更換門檻：壁厚損耗達 60% 即需更換</Tag>
              </Step>
            </div>

            <div className="mt-5 p-3 bg-blue-950/40 border border-blue-900/50 rounded-lg flex gap-2 text-xs text-slate-300">
              <Info size={14} className="text-blue-400 mt-0.5 shrink-0" />
              <span>此為線性速率估算，實際壽命受操作條件、冷卻水水質、材質等因素影響，建議每次大修後重新評估。</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 子元件 ──────────────────────────────────────────

function KpiCard({ title, value, subtitle, badge, icon, alert = false, onClick, clickable = false }:
  { title: string; value: string; subtitle: string; badge?: string; icon: React.ReactNode; alert?: boolean; onClick?: () => void; clickable?: boolean }) {
  return (
    <div
      onClick={onClick}
      className={`bg-slate-900 p-4 rounded-xl shadow-sm border transition-all hover:scale-[1.02]
        ${alert ? 'border-red-900/50 bg-red-900/10' : 'border-slate-800'}
        ${clickable ? 'cursor-pointer hover:border-blue-700/60 hover:bg-blue-950/20' : ''}`}
    >
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs font-medium text-slate-400 mb-0.5">{title}</p>
          <h3 className={`text-2xl font-bold ${alert ? 'text-red-400' : 'text-white'}`}>{value}</h3>
        </div>
        <div className="p-1.5 bg-slate-800/50 rounded-lg">{icon}</div>
      </div>
      <p className={`text-xs mt-1 ${alert ? 'text-red-400 font-medium' : 'text-slate-400'}`}>{subtitle}</p>
      {badge && (
        <span className="inline-block mt-1 text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded-full">
          {badge}
        </span>
      )}
      {clickable && <p className="text-[10px] text-blue-500 mt-1">點擊查看計算步驟 →</p>}
    </div>
  );
}

function DonutChart({ normal, warning, plugged, retubed, total, size = 120, strokeWidth = 15, innerText = "", subText = "" }:
  { normal: number; warning: number; plugged: number; retubed: number; total: number; size?: number; strokeWidth?: number; innerText?: string; subText?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;

  const pNormal = total > 0 ? normal / total : 0;
  const pWarning = total > 0 ? warning / total : 0;
  const pPlugged = total > 0 ? plugged / total : 0;
  const pRetubed = total > 0 ? retubed / total : 0;

  let currentOffset = 0;

  const createSegment = (val: number, color: string) => {
    const strokeLength = val * circumference;
    const offset = -currentOffset;
    currentOffset += strokeLength;
    if (val === 0) return null;
    return (
      <circle
        key={color}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="transparent"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${strokeLength} ${circumference}`}
        strokeDashoffset={offset}
        className="transition-all duration-1000 ease-in-out"
      />
    );
  };

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke="#1e293b" strokeWidth={strokeWidth} />
        {createSegment(pRetubed, '#3b82f6')}
        {createSegment(pPlugged, '#64748b')}
        {createSegment(pWarning, '#f59e0b')}
        {createSegment(pNormal, '#10b981')}
      </svg>
      {innerText && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-bold text-slate-200">{innerText}</span>
          {subText && <span className="text-[10px] text-slate-400 mt-0.5">{subText}</span>}
        </div>
      )}
    </div>
  );
}

function StatusLegend() {
  const items = [
    { color: 'bg-emerald-500', label: '正常運行' },
    { color: 'bg-amber-500', label: '劣化警示 (>=40%)' },
    { color: 'bg-slate-500', label: '已塞管' },
    { color: 'bg-blue-500', label: '已換管' },
  ];
  return (
    <div className="flex flex-wrap gap-2 mt-1 justify-center">
      {items.map(i => (
        <div key={i.label} className="flex items-center gap-1">
          <div className={`w-2.5 h-2.5 rounded-sm ${i.color}`} />
          <span className="text-[10px] text-slate-400">{i.label}</span>
        </div>
      ))}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-700 text-white text-xs font-bold flex items-center justify-center">{n}</div>
        <p className="font-semibold text-slate-100 text-sm leading-tight">{title}</p>
      </div>
      <div className="flex-1 bg-slate-800/60 rounded-lg px-3 py-3 text-xs text-slate-300 space-y-1 flex flex-col justify-between">
        <div>{children}</div>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-block mt-2 text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded">{children}</span>;
}
