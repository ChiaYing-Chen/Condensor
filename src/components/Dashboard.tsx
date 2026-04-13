import React, { useMemo } from 'react';
import { UnitData } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react';

interface DashboardProps {
  unitData: UnitData;
}

export default function Dashboard({ unitData }: DashboardProps) {
  const latestYear = Math.max(...unitData.overhauls.map(o => o.year));
  
  const stats = useMemo(() => {
    let plugged = 0;
    let retubed = 0;
    let normal = 0;
    let warning = 0; // >60% depth
    let totalThinningRate = 0;
    let thinningCount = 0;

    unitData.tubes.forEach(tube => {
      const latestInspection = tube.inspections.find(i => i.year === latestYear);
      if (!latestInspection) return;

      if (latestInspection.status === 'Plugged') plugged++;
      else if (latestInspection.status === 'Retubed') retubed++;
      else {
        normal++;
        if (latestInspection.depthValue > 60) warning++;
      }

      // Calculate average thinning rate (last two inspections)
      const sortedInspections = [...tube.inspections].sort((a, b) => b.year - a.year);
      if (sortedInspections.length >= 2 && sortedInspections[0].status === 'Normal') {
        const rate = (sortedInspections[0].depthValue - sortedInspections[1].depthValue) / 
                     (sortedInspections[0].year - sortedInspections[1].year);
        if (rate > 0) {
          totalThinningRate += rate;
          thinningCount++;
        }
      }
    });

    const avgThinningRate = thinningCount > 0 ? totalThinningRate / thinningCount : 0;
    // RUL = (100 - average current depth) / average thinning rate
    const avgDepth = unitData.tubes.reduce((acc, tube) => {
      const insp = tube.inspections.find(i => i.year === latestYear);
      return acc + (insp && insp.status === 'Normal' ? insp.depthValue : 0);
    }, 0) / (normal || 1);
    
    const rul = avgThinningRate > 0 ? (100 - avgDepth) / avgThinningRate : 99;

    return { plugged, retubed, normal, warning, avgThinningRate, rul };
  }, [unitData, latestYear]);

  const pluggingRatio = (stats.plugged / unitData.totalTubes) * 100;
  const isPluggingWarning = pluggingRatio > 8; // Warning if > 8% (close to 10% limit)

  const pieData = [
    { name: '正常運行', value: stats.normal - stats.warning, color: '#10b981' }, // emerald-500
    { name: '劣化警示 (>60%)', value: stats.warning, color: '#f59e0b' }, // amber-500
    { name: '已塞管', value: stats.plugged, color: '#64748b' }, // slate-500
    { name: '已換管', value: stats.retubed, color: '#3b82f6' }, // blue-500
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">總覽儀表板</h2>
        <p className="text-slate-400">最新大修年份: {latestYear} | 總管數: {unitData.totalTubes.toLocaleString()}</p>
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
          value={`${stats.rul.toFixed(1)} 年`} 
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
          title="高風險管數 (>60%)" 
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
            {['IL (入口左側)', 'IR (入口右側)', 'OL (出口左側)', 'OR (出口右側)'].map((quad, idx) => {
              const q = ['IL', 'IR', 'OL', 'OR'][idx];
              const quadTubes = unitData.tubes.filter(t => t.quadrant === q);
              const quadPlugged = quadTubes.filter(t => t.inspections.find(i => i.year === latestYear)?.status === 'Plugged').length;
              const ratio = quadTubes.length > 0 ? (quadPlugged / quadTubes.length) * 100 : 0;
              
              return (
                <div key={q}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-300">{quad}</span>
                    <span className="text-slate-400">塞管率: {ratio.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2.5">
                    <div 
                      className={`h-2.5 rounded-full ${ratio > 10 ? 'bg-red-500' : ratio > 5 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                      style={{ width: `${Math.min(ratio, 100)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-sm text-slate-400 mt-4">
            * 若單一區域塞管率過高，可能導致局部流速增加，加速周圍管束劣化（Flow-induced vibration）。
          </p>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, subtitle, icon, alert = false }: { title: string, value: string, subtitle: string, icon: React.ReactNode, alert?: boolean }) {
  return (
    <div className={`bg-slate-900 p-6 rounded-xl shadow-sm border ${alert ? 'border-red-900/50 bg-red-900/10' : 'border-slate-800'}`}>
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
