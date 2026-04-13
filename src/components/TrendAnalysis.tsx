import React, { useMemo, useState } from 'react';
import { UnitData } from '../types';
import { Download, TrendingUp, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';

interface TrendAnalysisProps {
  unitData: UnitData;
}

export default function TrendAnalysis({ unitData }: TrendAnalysisProps) {
  const overhauls = useMemo(() => [...unitData.overhauls].sort((a, b) => b.year - a.year), [unitData]);
  const [currentYear, setCurrentYear] = useState(overhauls[0]?.year);
  const [previousYear, setPreviousYear] = useState(overhauls[1]?.year);

  const deltaData = useMemo(() => {
    if (!currentYear || !previousYear) return [];

    return unitData.tubes.map(tube => {
      const currentInsp = tube.inspections.find(i => i.year === currentYear);
      const prevInsp = tube.inspections.find(i => i.year === previousYear);

      if (!currentInsp || !prevInsp) return null;

      if (prevInsp.status !== 'Normal') return null;

      let thinningRate = 0;
      if (currentInsp.status === 'Normal') {
        thinningRate = (currentInsp.depthValue - prevInsp.depthValue) / (currentYear - previousYear);
      } else if (currentInsp.status === 'Plugged') {
        thinningRate = (100 - prevInsp.depthValue) / (currentYear - previousYear);
      }

      return {
        id: tube.id,
        quadrant: tube.quadrant,
        prevDepth: prevInsp.depthValue,
        currentDepth: currentInsp.status === 'Normal' ? currentInsp.depthValue : 100,
        status: currentInsp.status,
        thinningRate,
        defectType: currentInsp.defectType
      };
    }).filter(Boolean) as any[];
  }, [unitData, currentYear, previousYear]);

  const sortedDeltaData = useMemo(() => [...deltaData].sort((a, b) => b.thinningRate - a.thinningRate), [deltaData]);

  const abnormalTubes = sortedDeltaData.filter(d => d.thinningRate > 10);

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(sortedDeltaData.map(d => ({
      '管號 (Tube ID)': d.id,
      '區域 (Quadrant)': d.quadrant,
      [`${previousYear} 深度 (%)`]: d.prevDepth.toFixed(2),
      [`${currentYear} 深度 (%)`]: d.status === 'Normal' ? d.currentDepth.toFixed(2) : `已塞管 (${d.currentDepth})`,
      '狀態 (Status)': d.status,
      '劣化速率 (%/年)': d.thinningRate.toFixed(2),
      '缺陷類型 (Defect)': d.defectType
    })));
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Delta View");
    XLSX.writeFile(wb, `Condenser_Delta_${previousYear}_to_${currentYear}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white">多期對比分析 (Trend Analysis)</h2>
          <p className="text-slate-400">差異比對 (Delta View) 與劣化速率追蹤</p>
        </div>
        <button 
          onClick={handleExportExcel}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
        >
          <Download size={18} />
          <span>下載比對結果 (Excel)</span>
        </button>
      </div>

      <div className="bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800">
        <div className="flex items-center gap-6 mb-6 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-300">本次大修:</label>
            <select 
              value={currentYear} 
              onChange={(e) => setCurrentYear(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-1.5 text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              {overhauls.map(o => <option key={`curr-${o.year}`} value={o.year}>{o.year}</option>)}
            </select>
          </div>
          <div className="text-slate-500 font-bold">VS</div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-300">上次大修:</label>
            <select 
              value={previousYear} 
              onChange={(e) => setPreviousYear(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-1.5 text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              {overhauls.filter(o => o.year < currentYear).map(o => <option key={`prev-${o.year}`} value={o.year}>{o.year}</option>)}
            </select>
          </div>
        </div>

        {abnormalTubes.length > 0 && (
          <div className="mb-6 p-4 bg-amber-900/20 border border-amber-900/50 rounded-lg flex items-start gap-3">
            <AlertCircle className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-amber-400">發現劣化速度異常區域</h4>
              <p className="text-sm text-amber-300 mt-1">
                共有 {abnormalTubes.length} 支管的減薄速率超過 10%/年。主要集中在 
                <span className="font-bold ml-1">
                  {Object.entries(abnormalTubes.reduce((acc, t) => { acc[t.quadrant] = (acc[t.quadrant] || 0) + 1; return acc; }, {} as Record<string, number>))
                    .sort((a, b) => b[1] - a[1])[0]?.[0] || '未知'}
                </span> 區域。可能原因：靠近汽輪機排汽口的高流速區 (High velocity steam area)。
              </p>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-800/50 border-y border-slate-800">
                <th className="py-3 px-4 text-sm font-semibold text-slate-400">管號</th>
                <th className="py-3 px-4 text-sm font-semibold text-slate-400">區域</th>
                <th className="py-3 px-4 text-sm font-semibold text-slate-400">{previousYear} 深度</th>
                <th className="py-3 px-4 text-sm font-semibold text-slate-400">{currentYear} 深度</th>
                <th className="py-3 px-4 text-sm font-semibold text-slate-400">劣化速率 (Thinning Rate)</th>
                <th className="py-3 px-4 text-sm font-semibold text-slate-400">狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sortedDeltaData.slice(0, 100).map((row, idx) => (
                <tr key={row.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="py-3 px-4 text-sm font-medium text-white">{row.id}</td>
                  <td className="py-3 px-4 text-sm text-slate-400">{row.quadrant}</td>
                  <td className="py-3 px-4 text-sm text-slate-400">{row.prevDepth.toFixed(1)}%</td>
                  <td className="py-3 px-4 text-sm font-medium">
                    {row.status === 'Plugged' ? (
                      <span className="text-slate-500">已塞管</span>
                    ) : (
                      <span className={row.currentDepth > 60 ? 'text-red-400' : 'text-slate-200'}>
                        {row.currentDepth.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${row.thinningRate > 10 ? 'text-red-400' : row.thinningRate > 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        +{row.thinningRate.toFixed(2)}% / 年
                      </span>
                      {row.thinningRate > 10 && <TrendingUp size={14} className="text-red-500" />}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {row.status === 'Normal' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-900/30 text-emerald-400">
                        正常運行
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300">
                        {row.status === 'Plugged' ? '已塞管' : '已換管'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedDeltaData.length > 100 && (
            <div className="text-center py-4 text-sm text-slate-500 border-t border-slate-800">
              僅顯示前 100 筆劣化最嚴重的資料，完整資料請點擊右上角下載 Excel。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
