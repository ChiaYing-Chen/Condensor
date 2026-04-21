import React, { useState, useEffect, useMemo } from 'react';
import { UnitData } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { AlertTriangle, CheckCircle, XCircle, Clock, Database, Loader2 } from 'lucide-react';

interface DashboardProps {
  unitData: any; // Using any to handle various stages of data hydration
}

export default function Dashboard({ unitData }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [latestYear, setLatestYear] = useState(0);
  const [stats, setStats] = useState({ plugged: 0, retubed: 0, normal: 0, warning: 0, avgThinningRate: 0, rul: 0 });
  const [zoneStats, setZoneStats] = useState<Record<string, { plugged: number; total: number }>>({
    IL: { plugged: 0, total: 0 },
    IR: { plugged: 0, total: 0 },
    OL: { plugged: 0, total: 0 },
    OR: { plugged: 0, total: 0 }
  });
  const totalTubes = 6312;

  useEffect(() => {
    if (!unitData || !unitData.unit_id) return;
    
    setLoading(true);
    fetch(`${import.meta.env.BASE_URL}api/years?unit_id=${unitData.unit_id}`)
      .then(res => res.json())
      .then(async years => {
        if (!Array.isArray(years) || years.length === 0) {
           setStats({ plugged: 0, retubed: 0, normal: 0, warning: 0, avgThinningRate: 0, rul: 0 });
           setZoneStats({
              IL: { plugged: 0, total: 0 },
              IR: { plugged: 0, total: 0 },
              OL: { plugged: 0, total: 0 },
              OR: { plugged: 0, total: 0 }
           });
           setLatestYear(0);
           setLoading(false);
           return;
        }
        
        const sortedYears = years.sort((a,b) => b - a);
        const latest = sortedYears[0];
        setLatestYear(latest);

        const recordsRes = await fetch(`${import.meta.env.BASE_URL}api/records?unit_id=${unitData.unit_id}&year=${latest}`).then(r => r.json());
        const maintRes = await fetch(`${import.meta.env.BASE_URL}api/maintenance?unit_id=${unitData.unit_id}&year=${latest}`).then(r => r.json());
        
        let prevRecordsRes: any[] = [];
        let effectiveDiff = 1;
        if (sortedYears.length > 1) {
           const prevYear = sortedYears[1];
           effectiveDiff = latest - prevYear;
           prevRecordsRes = await fetch(`${import.meta.env.BASE_URL}api/records?unit_id=${unitData.unit_id}&year=${prevYear}`).then(r => r.json());
        }

        let plugged = 0;
        let retubed = 0;
        let normal = 0;
        let warning = 0;
        let totalThinningRate = 0;
        let thinningCount = 0;
        let validDepthSum = 0;
        let validDepthCount = 0;

        let zStats: Record<string, { plugged: number; total: number }> = {
            IL: { plugged: 0, total: 0 },
            IR: { plugged: 0, total: 0 },
            OL: { plugged: 0, total: 0 },
            OR: { plugged: 0, total: 0 }
        };

        const prevMap = new Map();
        if (Array.isArray(prevRecordsRes)) {
           prevRecordsRes.forEach(r => {
             const code = r.code || 'NDD';
             prevMap.set(`${r.zone}-${r.row_num}-${r.col_num}`, {
                isPlugged: code === 'PLG',
                depth: Number(r.size_val) || 0
             });
           });
        }

        if (Array.isArray(recordsRes)) {
           recordsRes.forEach(r => {
             const id = `${r.zone}-${r.row_num}-${r.col_num}`;
             const action = Array.isArray(maintRes) ? maintRes.find(m => m.zone === r.zone && m.row_num === r.row_num && m.col_num === r.col_num) : null;
             
             let isPlugged = r.code === 'PLG';
             let isRetubed = false;
             let depth = Number(r.size_val) || 0;
             const code = r.code || 'NDD';

             if (action) {
               if (action.action === 'PLG') isPlugged = true;
               else if (action.action === 'RPL') { isPlugged = false; isRetubed = true; depth = 0; }
             } else {
               if (depth > 50) isPlugged = true;
               if (code === 'COR') isPlugged = true;
             }
             
             if (zStats[r.zone]) {
               zStats[r.zone].total++;
             }

             if (isPlugged) {
               plugged++;
               if (zStats[r.zone]) zStats[r.zone].plugged++;
             } else if (isRetubed) {
               retubed++;
             } else {
               normal++;
               if (depth > 50) warning++;
               validDepthSum += depth;
               validDepthCount++;
               
               const prev = prevMap.get(id);
               if (prev && !prev.isPlugged && prev.depth <= depth) {
                  const rate = (depth - prev.depth) / effectiveDiff;
                  if (rate > 0) {
                     totalThinningRate += rate;
                     thinningCount++;
                  }
               }
             }
           });
        }

        const avgThinningRate = thinningCount > 0 ? (totalThinningRate / thinningCount) : 0;
        const avgDepth = validDepthCount > 0 ? (validDepthSum / validDepthCount) : 0;
        const rul = avgThinningRate > 0 ? (100 - avgDepth) / avgThinningRate : 99;

        setStats({ plugged, retubed, normal, warning, avgThinningRate, rul });
        setZoneStats(zStats);
        setLoading(false);
      })
      .catch(err => {
         console.error(err);
         setLoading(false);
      });

  }, [unitData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <h3 className="text-xl font-bold text-slate-300">資料計算中...</h3>
      </div>
    );
  }

  const pluggingRatio = (stats.plugged / totalTubes) * 100;
  const isPluggingWarning = pluggingRatio > 8; // Warning if > 8% (close to 10% limit)

  const pieData = [
    { name: '正常運行', value: stats.normal - stats.warning, color: '#10b981' }, // emerald-500
    { name: '劣化警示 (>50%)', value: stats.warning, color: '#f59e0b' }, // amber-500
    { name: '已塞管', value: stats.plugged, color: '#64748b' }, // slate-500
    { name: '已換管', value: stats.retubed, color: '#3b82f6' }, // blue-500
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold text-white">總覽儀表板 - {unitData.name}</h2>
        <p className="text-slate-400">
          {latestYear > 0 ? `最新大修年份: ${latestYear}` : '尚未有大修紀錄'} | 總管數: {totalTubes.toLocaleString()}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
          icon={<Clock className="text-blue-500" />}
        />
        <KpiCard 
          title="已塞管數量" 
          value={stats.plugged.toLocaleString()} 
          subtitle="需持續追蹤"
          icon={<XCircle className="text-slate-400" />}
        />
        <KpiCard 
          title="高風險管數 (>50%)" 
          value={stats.warning.toLocaleString()} 
          subtitle="建議下次大修處理"
          icon={<AlertTriangle className="text-amber-500" />}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800">
          <h3 className="text-lg font-semibold text-slate-100 mb-4">管束狀態分佈</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  formatter={(value: number) => [value.toLocaleString(), '數量']} 
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f1f5f9' }}
                  itemStyle={{ color: '#f1f5f9' }}
                />
                <Legend wrapperStyle={{ color: '#cbd5e1' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800">
          <h3 className="text-lg font-semibold text-slate-100 mb-4">區域熱交換惡化評估</h3>
          <div className="space-y-4">
            {['IL', 'IR', 'OL', 'OR'].map((quad) => {
              const zoneInfo = zoneStats[quad] || { plugged: 0, total: 0 };
              const ratio = zoneInfo.total > 0 ? (zoneInfo.plugged / zoneInfo.total) * 100 : 0;
              
              return (
                <div key={quad}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-300">{quad} 區域</span>
                    <span className="text-slate-400">塞管率: {ratio.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2.5">
                    <div 
                      className={`h-2.5 rounded-full transition-all duration-1000 ${ratio > 10 ? 'bg-red-500' : ratio > 5 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                      style={{ width: `${Math.min(ratio, 100)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-sm text-slate-400 mt-4">
            * 若單一區域塞管率過高，可能導致局部流速增加，加速周圍管束劣化。
          </p>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, subtitle, icon, alert = false }: { title: string, value: string, subtitle: string, icon: React.ReactNode, alert?: boolean }) {
  return (
    <div className={`bg-slate-900 p-6 rounded-xl shadow-sm border transition-all hover:scale-[1.02] ${alert ? 'border-red-900/50 bg-red-900/10' : 'border-slate-800'}`}>
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-medium text-slate-400 mb-1">{title}</p>
          <h3 className={`text-3xl font-bold ${alert ? 'text-red-400' : 'text-white'}`}>{value}</h3>
        </div>
        <div className="p-2 bg-slate-800/50 rounded-lg">
          {icon}
        </div>
      </div>
      <p className={`text-sm mt-2 ${alert ? 'text-red-400 font-medium' : 'text-slate-400'}`}>{subtitle}</p>
    </div>
  );
}
