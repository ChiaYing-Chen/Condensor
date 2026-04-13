import React, { useState } from 'react';
import { Activity, LayoutDashboard, Settings, FileSpreadsheet, PlayCircle, Server } from 'lucide-react';
import Dashboard from './components/Dashboard';
import TubeSheetCanvas from './components/TubeSheetCanvas';
import TrendAnalysis from './components/TrendAnalysis';
import DecisionSystem from './components/DecisionSystem';
import DataImport from './components/DataImport';
import { mockUnits } from './utils/mockData';

type Tab = 'dashboard' | 'canvas' | 'trend' | 'decision' | 'import';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('U1');
  
  const unitData = mockUnits.find(u => u.id === selectedUnitId) || mockUnits[0];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard unitData={unitData} />;
      case 'canvas': return <TubeSheetCanvas unitData={unitData} />;
      case 'trend': return <TrendAnalysis unitData={unitData} />;
      case 'decision': return <DecisionSystem unitData={unitData} />;
      case 'import': return <DataImport onImport={(data) => {}} currentData={unitData} />;
      default: return <Dashboard unitData={unitData} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans text-slate-200">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 shadow-md z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-500" />
            <h1 className="text-xl font-bold tracking-tight text-white">冷凝器分析與管理平台</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Server size={16} />
              <span>切換機組:</span>
            </div>
            <select
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white rounded-md px-3 py-1.5 text-sm focus:ring-blue-500 focus:border-blue-500 outline-none cursor-pointer"
            >
              {mockUnits.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
          <nav className="flex-1 px-4 py-6 space-y-2">
            <NavItem icon={<LayoutDashboard size={20} />} label="總覽儀表板" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <NavItem icon={<PlayCircle size={20} />} label="數位孿生與動態演變" active={activeTab === 'canvas'} onClick={() => setActiveTab('canvas')} />
            <NavItem icon={<Activity size={20} />} label="多期對比分析" active={activeTab === 'trend'} onClick={() => setActiveTab('trend')} />
            <NavItem icon={<Settings size={20} />} label="維護決策系統" active={activeTab === 'decision'} onClick={() => setActiveTab('decision')} />
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
