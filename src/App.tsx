import React, { useState, useEffect } from 'react';
import { Activity, LayoutDashboard, Settings, FileSpreadsheet, PlayCircle, Server, Loader2 } from 'lucide-react';
import Dashboard from './components/Dashboard';
import TubeSheetCanvas from './components/TubeSheetCanvas';
import TrendAnalysis from './components/TrendAnalysis';
import DecisionSystem from './components/DecisionSystem';
import DataImport from './components/DataImport';

type Tab = 'dashboard' | 'canvas' | 'trend' | 'decision' | 'import';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('TG-1');
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbOffline, setDbOffline] = useState(false);
  const [highlightTubes, setHighlightTubes] = useState<Set<string> | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/units`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setUnits(data);
          setSelectedUnitId(data[0].unit_id);
          setDbOffline(false);
        } else {
          // 成功回應但無資料（DB 已連線但尚未初始化）
          setDbOffline(false);
        }
      })
      .catch(() => {
        // DB 無法連線或後端尚未啟動
        setDbOffline(true);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-blue-500 gap-2">
        <Loader2 className="animate-spin" size={24} />
        <span>載入機組資料中...</span>
      </div>
    );
  }

  // Pass current selected unit id and its details to children that need it
  const currentUnit = units.find(u => u.unit_id === selectedUnitId) || units[0];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard unitData={currentUnit} />;
      case 'canvas': return <TubeSheetCanvas unitId={selectedUnitId} highlightTubes={highlightTubes} onClearHighlight={() => setHighlightTubes(null)} />;
      case 'trend': return <TrendAnalysis unitData={currentUnit} />;
      case 'decision': return <DecisionSystem unitData={currentUnit} onApplyToVisual={(ids: string[]) => { setHighlightTubes(new Set(ids)); setActiveTab('canvas'); }} />;
      case 'import': return <DataImport unitId={selectedUnitId} />;
      default: return <TubeSheetCanvas unitId={selectedUnitId} highlightTubes={highlightTubes} onClearHighlight={() => setHighlightTubes(null)} />;
    }
  };


  return (
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans text-slate-200">
      {/* DB 離線警告橫幅 */}
      {dbOffline && (
        <div className="bg-amber-900/30 border-b border-amber-700/50 px-4 py-2 flex items-center gap-3 text-amber-400 text-sm">
          <span className="text-lg">⚠️</span>
          <span className="font-medium">資料庫目前無法連線</span>
          <span className="text-amber-500/80">— 資料顯示功能暫停，但您仍可上傳 Excel/CSV 進行本地格式驗證。請確認後端伺服器正在運行（</span>
          <code className="bg-slate-800 px-1.5 py-0.5 rounded text-xs font-mono text-amber-300">node server.js</code>
          <span className="text-amber-500/80">），並在資料庫連線後重新整理頁面。</span>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col shadow-xl z-20">
          {/* Logo Area */}
          <div className="px-6 py-6 border-b border-slate-800 flex items-center gap-3">
            <Activity className="h-7 w-7 text-blue-500 shrink-0" />
            <h1 className="text-xl font-bold tracking-tight text-white leading-tight">冷凝器分析與管理平台</h1>
          </div>

          {/* Unit Switcher */}
          <div className="px-5 py-5 border-b border-slate-800/80 bg-slate-900/50">
            <div className="flex items-center gap-2 text-sm text-slate-400 mb-2">
              <Server size={16} />
              <span className="font-medium">目前的檢視機組</span>
            </div>
            <select
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:ring-blue-500 focus:border-blue-500 shadow-inner outline-none cursor-pointer font-bold"
            >
              {units.length > 0
                ? units.map(u => (
                    <option key={u.unit_id} value={u.unit_id}>{u.name}</option>
                  ))
                : /* 資料庫離線時的預設選項 */
                  ['TG-1', 'TG-2', 'TG-3', 'TG-4'].map(id => (
                    <option key={id} value={id}>{id}</option>
                  ))
              }
            </select>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
            <NavItem icon={<LayoutDashboard size={20} />} label="總覽儀表板" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <NavItem icon={<PlayCircle size={20} />} label="動態視覺檢視" active={activeTab === 'canvas'} onClick={() => setActiveTab('canvas')} />
            <NavItem icon={<Activity size={20} />} label="瑕疵深度比對" active={activeTab === 'trend'} onClick={() => setActiveTab('trend')} />
            <NavItem icon={<Settings size={20} />} label="處置篩選系統" active={activeTab === 'decision'} onClick={() => setActiveTab('decision')} />
            <NavItem icon={<FileSpreadsheet size={20} />} label="資料匯入與匯出" active={activeTab === 'import'} onClick={() => setActiveTab('import')} />
          </nav>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );

}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
        active 
          ? 'bg-blue-900/50 text-blue-400 font-medium border border-blue-800/50' 
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

