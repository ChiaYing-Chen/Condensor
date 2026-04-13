import React, { useState, useMemo } from 'react';
import { UnitData, MaintenancePolicy } from '../types';
import { Settings2, ShieldAlert, Wrench, AlertTriangle } from 'lucide-react';

interface DecisionSystemProps {
  unitData: UnitData;
}

export default function DecisionSystem({ unitData }: DecisionSystemProps) {
  const [policy, setPolicy] = useState<MaintenancePolicy>({
    pluggingThreshold: 60,
    thinningRateThreshold: 10
  });

  const latestYear = Math.max(...unitData.overhauls.map(o => o.year));
  const previousYear = Math.max(...unitData.overhauls.filter(o => o.year < latestYear).map(o => o.year));

  const suggestedList = useMemo(() => {
    return unitData.tubes.map(tube => {
      const currentInsp = tube.inspections.find(i => i.year === latestYear);
      const prevInsp = tube.inspections.find(i => i.year === previousYear);

      if (!currentInsp || currentInsp.status !== 'Normal') return null;

      const currentDepth = currentInsp.depthValue;
      let thinningRate = 0;
      if (prevInsp && prevInsp.status === 'Normal') {
        thinningRate = (currentDepth - prevInsp.depthValue) / (latestYear - previousYear);
      }

      const predictedDepth = currentDepth + (thinningRate * 2);

      const reasons: string[] = [];
      if (currentDepth >= policy.pluggingThreshold) {
        reasons.push(`當前深度 (${currentDepth.toFixed(1)}%) 超過閾值 (${policy.pluggingThreshold}%)`);
      }
      if (thinningRate >= policy.thinningRateThreshold) {
        reasons.push(`劣化速率 (${thinningRate.toFixed(1)}%/年) 過快`);
      }
      if (predictedDepth >= 100) {
        reasons.push(`預測下次大修前將穿孔 (預測值: ${predictedDepth.toFixed(1)}%)`);
      }

      if (reasons.length > 0) {
        return {
          id: tube.id,
          quadrant: tube.quadrant,
          currentDepth,
          thinningRate,
          predictedDepth,
          reasons
        };
      }
      return null;
    }).filter(Boolean) as any[];
  }, [unitData, latestYear, previousYear, policy]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">維護決策系統</h2>
        <p className="text-slate-400">基於檢測數據與預測模型，自動生成建議塞管清單</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800 h-fit">
          <div className="flex items-center gap-2 mb-4">
            <Settings2 className="text-blue-500" />
            <h3 className="text-lg font-semibold text-slate-100">處置對策設定</h3>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                強制塞管閾值 (Depth %)
              </label>
              <div className="flex items-center gap-3">
                <input 
                  type="range" 
                  min="40" max="90" step="5"
                  value={policy.pluggingThreshold}
                  onChange={(e) => setPolicy({...policy, pluggingThreshold: Number(e.target.value)})}
                  className="flex-1 accent-blue-500"
                />
                <span className="w-12 text-right font-bold text-slate-300">{policy.pluggingThreshold}%</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">當前檢測深度大於此值時，列入建議清單。</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                異常劣化速率閾值 (%/年)
              </label>
              <div className="flex items-center gap-3">
                <input 
                  type="range" 
                  min="5" max="20" step="1"
                  value={policy.thinningRateThreshold}
                  onChange={(e) => setPolicy({...policy, thinningRateThreshold: Number(e.target.value)})}
                  className="flex-1 accent-blue-500"
                />
                <span className="w-12 text-right font-bold text-slate-300">{policy.thinningRateThreshold}%</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">減薄速率過快，即使未達絕對深度也建議預防性塞管。</p>
            </div>

            <div className="pt-4 border-t border-slate-800">
              <div className="bg-blue-900/20 text-blue-400 p-3 rounded-lg text-sm">
                <strong>預測模型啟用中：</strong> 系統將自動以當前劣化速率推算下次大修 (預設 2 年後) 的管壁深度，若預測將穿孔 (&gt;100%)，將強制列入清單。
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="text-red-500" />
              <h3 className="text-lg font-semibold text-slate-100">建議塞管清單</h3>
            </div>
            <div className="text-sm font-medium bg-red-900/20 text-red-400 px-3 py-1 rounded-full">
              共 {suggestedList.length} 支管需處理
            </div>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-900 shadow-sm z-10">
                <tr className="bg-slate-800/50 border-y border-slate-800">
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">管號</th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">當前深度</th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">預測深度 (下次大修)</th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">建議原因</th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-400">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {suggestedList.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/50">
                    <td className="py-3 px-4 text-sm font-medium text-white">{item.id}</td>
                    <td className="py-3 px-4 text-sm">
                      <span className={item.currentDepth >= policy.pluggingThreshold ? 'text-red-400 font-bold' : 'text-slate-300'}>
                        {item.currentDepth.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <div className="flex items-center gap-1">
                        <span className={item.predictedDepth >= 100 ? 'text-red-400 font-bold' : 'text-amber-400'}>
                          {item.predictedDepth.toFixed(1)}%
                        </span>
                        {item.predictedDepth >= 100 && <AlertTriangle size={14} className="text-red-500" />}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400">
                      <ul className="list-disc pl-4 space-y-0.5">
                        {item.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                      </ul>
                    </td>
                    <td className="py-3 px-4">
                      <button className="text-blue-500 hover:text-blue-400 text-sm font-medium flex items-center gap-1">
                        <Wrench size={14} />
                        開立工單
                      </button>
                    </td>
                  </tr>
                ))}
                {suggestedList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      目前無符合條件的建議塞管項目。
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
