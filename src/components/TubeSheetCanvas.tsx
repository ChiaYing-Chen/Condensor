import React, { useEffect, useRef, useState, useMemo } from 'react';
import { UnitData, TubeData, InspectionRecord } from '../types';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';

interface TubeSheetCanvasProps {
  unitData: UnitData;
}

export default function TubeSheetCanvas({ unitData }: TubeSheetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentYearIndex, setCurrentYearIndex] = useState(unitData.overhauls.length - 1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoveredTube, setHoveredTube] = useState<TubeData | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const overhauls = useMemo(() => [...unitData.overhauls].sort((a, b) => a.year - b.year), [unitData]);
  const currentYear = overhauls[currentYearIndex]?.year;

  useEffect(() => {
    let interval: number;
    if (isPlaying) {
      interval = window.setInterval(() => {
        setCurrentYearIndex((prev) => {
          if (prev >= overhauls.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, overhauls.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    
    ctx.clearRect(0, 0, width, height);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    unitData.tubes.forEach(t => {
      if (t.x < minX) minX = t.x;
      if (t.x > maxX) maxX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.y > maxY) maxY = t.y;
    });

    const padding = 40;
    const dataWidth = maxX - minX;
    const dataHeight = maxY - minY;
    
    const scale = Math.min(
      (width - padding * 2) / dataWidth,
      (height - padding * 2) / dataHeight
    );

    const offsetX = width / 2 - ((maxX + minX) / 2) * scale;
    const offsetY = height / 2 - ((maxY + minY) / 2) * scale;

    ctx.fillStyle = 'rgba(30, 41, 59, 0.5)';
    ctx.fillRect(offsetX + minX * scale, offsetY + minY * scale, dataWidth * scale / 2, dataHeight * scale / 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.fillRect(offsetX, offsetY + minY * scale, dataWidth * scale / 2, dataHeight * scale / 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.fillRect(offsetX + minX * scale, offsetY, dataWidth * scale / 2, dataHeight * scale / 2);
    ctx.fillStyle = 'rgba(30, 41, 59, 0.5)';
    ctx.fillRect(offsetX, offsetY, dataWidth * scale / 2, dataHeight * scale / 2);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(offsetX + minX * scale, offsetY);
    ctx.lineTo(offsetX + maxX * scale, offsetY);
    ctx.moveTo(offsetX, offsetY + minY * scale);
    ctx.lineTo(offsetX, offsetY + maxY * scale);
    ctx.stroke();

    const tubeRadius = Math.max(1.5, scale * 1.5);

    unitData.tubes.forEach(tube => {
      const cx = offsetX + tube.x * scale;
      const cy = offsetY + tube.y * scale;

      const inspection = tube.inspections.find(i => i.year === currentYear);
      let color = '#475569';

      if (inspection) {
        if (inspection.status === 'Plugged') color = '#64748b';
        else if (inspection.status === 'Retubed') color = '#3b82f6';
        else {
          const depth = inspection.depthValue;
          if (depth <= 20) color = '#10b981';
          else if (depth <= 40) color = '#84cc16';
          else if (depth <= 60) color = '#eab308';
          else if (depth <= 80) color = '#f97316';
          else color = '#ef4444';
        }
      }

      ctx.beginPath();
      ctx.arc(cx, cy, tubeRadius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      if (hoveredTube && hoveredTube.id === tube.id) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(cx, cy, tubeRadius + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.stroke();
      }
    });

  }, [unitData, currentYear, hoveredTube]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x: e.clientX, y: e.clientY });

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    unitData.tubes.forEach(t => {
      if (t.x < minX) minX = t.x;
      if (t.x > maxX) maxX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.y > maxY) maxY = t.y;
    });

    const padding = 40;
    const dataWidth = maxX - minX;
    const dataHeight = maxY - minY;
    
    const scale = Math.min(
      (rect.width - padding * 2) / dataWidth,
      (rect.height - padding * 2) / dataHeight
    );

    const offsetX = rect.width / 2 - ((maxX + minX) / 2) * scale;
    const offsetY = rect.height / 2 - ((maxY + minY) / 2) * scale;

    let closest: TubeData | null = null;
    let minDist = Infinity;

    unitData.tubes.forEach(tube => {
      const cx = offsetX + tube.x * scale;
      const cy = offsetY + tube.y * scale;
      const dist = Math.sqrt(Math.pow(cx - x, 2) + Math.pow(cy - y, 2));
      
      if (dist < 10 && dist < minDist) {
        minDist = dist;
        closest = tube;
      }
    });

    setHoveredTube(closest);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white">數位孿生與動態演變</h2>
          <p className="text-slate-400">冷凝器管板 (Tube Sheet) 劣化熱圖</p>
        </div>
        
        <div className="flex items-center gap-4 text-sm bg-slate-900 px-4 py-2 rounded-lg border border-slate-800 shadow-sm">
          <LegendItem color="bg-emerald-500" label="0-20%" />
          <LegendItem color="bg-lime-500" label="20-40%" />
          <LegendItem color="bg-yellow-500" label="40-60%" />
          <LegendItem color="bg-orange-500" label="60-80%" />
          <LegendItem color="bg-red-500" label=">80%" />
          <div className="w-px h-4 bg-slate-700 mx-1"></div>
          <LegendItem color="bg-slate-500" label="已塞管" />
          <LegendItem color="bg-blue-500" label="已換管" />
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl shadow-sm border border-slate-800 overflow-hidden flex flex-col">
        <div className="bg-slate-900 border-b border-slate-800 p-4 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => { setIsPlaying(false); setCurrentYearIndex(0); }}
              className="p-2 text-slate-400 hover:bg-slate-800 rounded-full transition-colors"
              title="回到最初"
            >
              <SkipBack size={20} />
            </button>
            <button 
              onClick={() => {
                if (currentYearIndex >= overhauls.length - 1) setCurrentYearIndex(0);
                setIsPlaying(!isPlaying);
              }}
              className="p-3 bg-blue-600 text-white hover:bg-blue-700 rounded-full transition-colors shadow-sm"
              title={isPlaying ? "暫停" : "播放"}
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
            </button>
            <button 
              onClick={() => { setIsPlaying(false); setCurrentYearIndex(overhauls.length - 1); }}
              className="p-2 text-slate-400 hover:bg-slate-800 rounded-full transition-colors"
              title="跳至最新"
            >
              <SkipForward size={20} />
            </button>
          </div>

          <div className="flex-1 px-4">
            <div className="relative flex items-center justify-between">
              <div className="absolute left-0 right-0 h-1 bg-slate-800 rounded-full top-1/2 -translate-y-1/2 z-0"></div>
              
              {overhauls.map((oh, idx) => (
                <div key={oh.year} className="relative z-10 flex flex-col items-center cursor-pointer group" onClick={() => { setIsPlaying(false); setCurrentYearIndex(idx); }}>
                  <div className={`w-4 h-4 rounded-full border-2 transition-colors ${
                    idx === currentYearIndex 
                      ? 'bg-blue-500 border-blue-500 scale-125' 
                      : idx < currentYearIndex 
                        ? 'bg-blue-900 border-blue-700' 
                        : 'bg-slate-800 border-slate-600 group-hover:border-blue-500'
                  }`}></div>
                  <span className={`absolute top-6 text-xs font-medium ${idx === currentYearIndex ? 'text-blue-400' : 'text-slate-500'}`}>
                    {oh.year}
                  </span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="text-right min-w-[100px]">
            <div className="text-sm text-slate-400">顯示年份</div>
            <div className="text-xl font-bold text-white">{currentYear}</div>
          </div>
        </div>

        <div className="relative w-full h-[600px] bg-slate-950">
          <canvas 
            ref={canvasRef} 
            className="w-full h-full cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredTube(null)}
          />
          
          {hoveredTube && (
            <div 
              className="fixed z-50 bg-slate-800 border border-slate-700 text-slate-200 p-4 rounded-lg shadow-xl text-sm pointer-events-none transform -translate-x-1/2 -translate-y-full mt-[-10px]"
              style={{ left: mousePos.x, top: mousePos.y }}
            >
              <div className="font-bold text-base mb-2 border-b border-slate-700 pb-1 text-white">
                管號: {hoveredTube.id} ({hoveredTube.quadrant})
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-slate-400">材質:</span>
                <span>{hoveredTube.material}</span>
                <span className="text-slate-400">安裝日:</span>
                <span>{hoveredTube.installDate}</span>
              </div>
              
              <div className="mt-3 pt-2 border-t border-slate-700">
                <div className="font-semibold mb-1 text-blue-400">檢測歷史 (一管一檔)</div>
                <div className="max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                  {[...hoveredTube.inspections].sort((a, b) => b.year - a.year).map(insp => (
                    <div key={insp.year} className={`flex justify-between items-center py-1 ${insp.year === currentYear ? 'bg-slate-700 px-1 rounded' : ''}`}>
                      <span className="font-medium text-white">{insp.year}</span>
                      <span className="flex items-center gap-2">
                        {insp.status !== 'Normal' ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${insp.status === 'Plugged' ? 'bg-slate-600' : 'bg-blue-600'} text-white`}>
                            {insp.status === 'Plugged' ? '已塞管' : '已換管'}
                          </span>
                        ) : (
                          <>
                            <span className={
                              insp.depthValue > 80 ? 'text-red-400' :
                              insp.depthValue > 60 ? 'text-orange-400' :
                              insp.depthValue > 40 ? 'text-yellow-400' :
                              insp.depthValue > 20 ? 'text-lime-400' : 'text-emerald-400'
                            }>{insp.depthValue.toFixed(1)}%</span>
                            {insp.defectType !== 'None' && <span className="text-xs text-slate-400">({insp.defectType})</span>}
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string, label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-3 h-3 rounded-full ${color}`}></div>
      <span className="text-slate-300">{label}</span>
    </div>
  );
}
