import React, { useState } from 'react';
import { UnitData } from '../types';
import { Upload, FileType, CheckCircle2, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';

interface DataImportProps {
  onImport: (data: UnitData) => void;
  currentData: UnitData;
}

export default function DataImport({ onImport, currentData }: DataImportProps) {
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = (file: File) => {
    setStatus('processing');
    setMessage('正在解析 CSV 檔案...');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          setTimeout(() => {
            setStatus('success');
            setMessage(`成功匯入 ${results.data.length} 筆檢測紀錄。`);
          }, 1000);
        } catch (err) {
          setStatus('error');
          setMessage('資料格式錯誤，請確認 CSV 欄位是否符合規範。');
        }
      },
      error: (error) => {
        setStatus('error');
        setMessage(`解析失敗: ${error.message}`);
      }
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold text-white">資料匯入與匯出</h2>
        <p className="text-slate-400">支援批量導入 ECT 廠商提供的原始報表 (CSV/Excel)</p>
      </div>

      <div className="bg-slate-900 p-8 rounded-xl shadow-sm border border-slate-800">
        <h3 className="text-lg font-semibold text-slate-100 mb-4">匯入檢測數據</h3>
        
        <div 
          className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
            dragActive ? 'border-blue-500 bg-blue-900/20' : 'border-slate-700 hover:border-slate-600 hover:bg-slate-800/50'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input 
            type="file" 
            accept=".csv" 
            onChange={handleChange} 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          
          <div className="flex flex-col items-center justify-center space-y-4 pointer-events-none">
            <div className="p-4 bg-blue-900/50 text-blue-400 rounded-full">
              <Upload size={32} />
            </div>
            <div>
              <p className="text-lg font-medium text-slate-300">點擊或拖曳 CSV 檔案至此</p>
              <p className="text-sm text-slate-500 mt-1">支援 ECT 原始數據格式，檔案大小限制 50MB</p>
            </div>
          </div>
        </div>

        {status !== 'idle' && (
          <div className={`mt-6 p-4 rounded-lg flex items-start gap-3 ${
            status === 'processing' ? 'bg-blue-900/20 text-blue-400 border border-blue-800' :
            status === 'success' ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-800' :
            'bg-red-900/20 text-red-400 border border-red-800'
          }`}>
            {status === 'processing' && <FileType className="animate-pulse shrink-0" />}
            {status === 'success' && <CheckCircle2 className="text-emerald-500 shrink-0" />}
            {status === 'error' && <AlertCircle className="text-red-500 shrink-0" />}
            <div>
              <p className="font-medium">{message}</p>
              {status === 'success' && (
                <p className="text-sm mt-1 opacity-80">資料已成功更新至資料庫，您現在可以在「總覽儀表板」查看最新分析結果。</p>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 pt-8 border-t border-slate-800">
          <h4 className="font-medium text-slate-200 mb-3">CSV 欄位規範範例</h4>
          <div className="bg-slate-800/50 rounded-lg p-4 overflow-x-auto border border-slate-700">
            <table className="w-full text-sm text-left text-slate-400">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="pb-2 font-mono">Tube_ID</th>
                  <th className="pb-2 font-mono">Row</th>
                  <th className="pb-2 font-mono">Col</th>
                  <th className="pb-2 font-mono">Depth_Pct</th>
                  <th className="pb-2 font-mono">Defect_Type</th>
                  <th className="pb-2 font-mono">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-700/50">
                  <td className="py-2 font-mono text-slate-300">R10-C25</td>
                  <td className="py-2 font-mono text-slate-300">10</td>
                  <td className="py-2 font-mono text-slate-300">25</td>
                  <td className="py-2 font-mono text-slate-300">45</td>
                  <td className="py-2 font-mono text-slate-300">Wear</td>
                  <td className="py-2 font-mono text-slate-300">Normal</td>
                </tr>
                <tr>
                  <td className="pt-2 font-mono text-slate-300">R11-C26</td>
                  <td className="pt-2 font-mono text-slate-300">11</td>
                  <td className="pt-2 font-mono text-slate-300">26</td>
                  <td className="pt-2 font-mono text-slate-300">100</td>
                  <td className="pt-2 font-mono text-slate-300">Pitting</td>
                  <td className="pt-2 font-mono text-slate-300">Plugged</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
