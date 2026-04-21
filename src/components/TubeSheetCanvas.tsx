import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Layers, Loader2, Download, Table2, Image as ImageIcon, Upload, Palette, Eye, EyeOff, X, Lock } from 'lucide-react';
import * as XLSX from 'xlsx';
import { generateTubeMap } from '../utils/tubeMapGenerator';

// =============================================================
// Air Cooling Zone (ACZ) 定義：IL/IR 內側前 28 行，每行的美应包含到第几COL
// =============================================================
const ACZ_BOUNDARY: Record<number, number> = {
  1: 9, 2: 9, 3: 10, 4: 10, 5: 11, 6: 11, 7: 12, 8: 12,
  9: 13, 10: 13, 11: 14, 12: 14, 13: 15, 14: 15, 15: 16, 16: 16,
  17: 17, 18: 17, 19: 18, 20: 18, 21: 19, 22: 19, 23: 20,
  24: 19, 25: 19, 26: 18, 27: 18, 28: 17
};
const ACZ_MAX_ROW = 28;

/** 產生 ACZ 簡化多邊形：只取三個外側關鍵頂點（頂、峰、底），形成斜線輪廓 */
function getACZPolygon(zone: 'IL' | 'IR'): { x: number; y: number }[] {
  const sign = zone === 'IL' ? -1 : 1;
  // 間隙中點精確計算（以 IR 為例）：
  //   col b 管中心 x = b-0.5，右緣 = b-0.1
  //   col b+1 管中心 x = b+0.5，左緣 = b+0.1
  //   → 間隙中點 = b  ←  不需要 +0.5
  const topCol  = ACZ_BOUNDARY[1];           // row 1,  col 9  → gap x = ±9
  const peakCol = ACZ_BOUNDARY[23];          // row 23, col 20 → gap x = ±20
  const botCol  = ACZ_BOUNDARY[ACZ_MAX_ROW]; // row 28, col 17 → gap x = ±17

  return [
    { x: 0,                y: 0.5            }, // 頂-內（中心線）
    { x: sign * topCol,    y: 0.5            }, // 頂-外（row 1 上方間隙）
    { x: sign * peakCol,   y: 23.5           }, // 峰點-外（row 23 下方間隙）
    { x: sign * botCol,    y: ACZ_MAX_ROW + 0.5 }, // 底-外（row 28 下方間隙）
    { x: 0,                y: ACZ_MAX_ROW + 0.5 }, // 底-內（中心線）
  ];
}

/** 在畫布上繪製 ACZ 粉紅輪廓框（直線 staircase，落在管束間隙） */
function drawACZOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  zones: ('IL' | 'IR')[],
  offsetX: number, offsetY: number, sc: number,
  isMirrored: boolean, W: number, _isPrintMode: boolean
) {
  const c = ctx as any;
  ctx.save();
  c.strokeStyle = 'rgba(244,114,182,0.95)';
  c.lineWidth = 2.5;
  c.setLineDash([]);
  c.lineJoin = 'miter';
  c.lineCap = 'butt';

  for (const zone of zones) {
    const poly = getACZPolygon(zone);
    c.beginPath();
    poly.forEach((pt: { x: number; y: number }, i: number) => {
      let cx = offsetX + pt.x * sc;
      if (isMirrored) cx = W - cx;
      const cy = offsetY + pt.y * sc;
      if (i === 0) c.moveTo(cx, cy); else c.lineTo(cx, cy);
    });
    c.closePath();
    c.stroke();
  }

  ctx.restore();
}

type ViewMode = 'before' | 'after';

interface TubeSheetCanvasProps {
  unitId: string;
  highlightTubes?: Set<string> | null;
  onClearHighlight?: () => void;
}

export default function TubeSheetCanvas({ unitId, highlightTubes, onClearHighlight }: TubeSheetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [currentYearIndex, setCurrentYearIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('before');

  // 播放步驟：每步代表 (yearIndex, viewMode) 的一格
  // 序列形式：[{yi:0,vm:'before'},{yi:0,vm:'after'},{yi:1,vm:'before'},{yi:1,vm:'after'},...]
  // 依 availableYears 和 maintenanceYears 動態計算
  const [playStepIndex, setPlayStepIndex] = useState(0);

  // records maps
  const [yearRecords, setYearRecords] = useState<Record<string, any>>({});
  const [maintenanceRecords, setMaintenanceRecords] = useState<Record<string, any>>({});
  const [registryRecords, setRegistryRecords] = useState<Record<string, any>>({});
  const [maintenanceYears, setMaintenanceYears] = useState<number[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [hoveredTube, setHoveredTube] = useState<any | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [quadrantFilter, setQuadrantFilter] = useState<string>('ALL');
  const [isRendering, setIsRendering] = useState(false);
  const [showGridMarkers, setShowGridMarkers] = useState(false);
  // 處置顏色視覺功能
  const [showDisposalColors, setShowDisposalColors] = useState(false);
  const [showOldPlugs, setShowOldPlugs] = useState(false);
  // 快速上傳 Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle'|'uploading'|'success'|'error'|'password_required'>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadPassword, setUploadPassword] = useState('');
  const [pendingUploadRecords, setPendingUploadRecords] = useState<any[]>([]);

  // 閨牍動畫相關 ref
  const blinkPhaseRef = useRef<boolean>(true); // true = 顯示, false = 隱藏
  const rafRef = useRef<number>(0);
  const lastBlinkTime = useRef<number>(0);
  const BLINK_INTERVAL = 500; // ms

  // Generate tubes once
  const tubes = useMemo(() => generateTubeMap(), []);

  const currentYear = availableYears.length > 0 ? availableYears[currentYearIndex] : null;
  const hasAfterData = currentYear ? maintenanceYears.includes(currentYear) : false;

  // 播放步驟序列：按「每年先before，若有after則接after」展開
  const playSteps = useMemo(() => {
    const steps: Array<{ yi: number; vm: ViewMode }> = [];
    availableYears.forEach((year, yi) => {
      steps.push({ yi, vm: 'before' });
      if (maintenanceYears.includes(year)) {
        steps.push({ yi, vm: 'after' });
      }
    });
    return steps;
  }, [availableYears, maintenanceYears]);

  // Initialize: Fetch available years and tube registry for this unit
  useEffect(() => {
    if (!unitId) return;

    setLoading(true);
    setCurrentYearIndex(0);
    setAvailableYears([]);
    setIsPlaying(false);

    Promise.all([
      fetch(`${import.meta.env.BASE_URL}api/years?unit_id=${unitId}`).then(res => res.json()),
      fetch(`${import.meta.env.BASE_URL}api/tubes?unit_id=${unitId}`).then(res => res.json()),
      fetch(`${import.meta.env.BASE_URL}api/maintenance/years?unit_id=${unitId}`).then(res => res.json())
    ]).then(([years, tubesRegistry, mainYears]) => {
      if (Array.isArray(years)) {
        const sorted = years.sort((a,b) => a - b);
        setAvailableYears(sorted);
        if (sorted.length > 0) {
          setCurrentYearIndex(sorted.length - 1); // Latest year
        }
      }
      
      if (Array.isArray(mainYears)) {
        setMaintenanceYears(mainYears);
      }
      
      const regMap: Record<string, any> = {};
      if (Array.isArray(tubesRegistry)) {
        tubesRegistry.forEach(r => {
          const id = `${r.zone}-${r.row_num}-${r.col_num}`;
          regMap[id] = r;
        });
      }
      setRegistryRecords(regMap);
    }).catch(console.error).finally(() => setLoading(false));

  }, [unitId]);

  // Fetch inspection (Before) & maintenance (After) records when year changes
  useEffect(() => {
    if (!currentYear || !unitId) return;
    setLoading(true);
    
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}api/records?unit_id=${unitId}&year=${currentYear}`).then(res => res.json()),
      fetch(`${import.meta.env.BASE_URL}api/maintenance?unit_id=${unitId}&year=${currentYear}`).then(res => res.json())
    ]).then(([inspectionRes, maintenanceRes]) => {
      const insMap: Record<string, any> = {};
      const mainMap: Record<string, any> = {};

      if (Array.isArray(inspectionRes)) {
        inspectionRes.forEach(r => {
          const id = `${r.zone}-${r.row_num}-${r.col_num}`;
          insMap[id] = r;
        });
      }

      if (Array.isArray(maintenanceRes)) {
        maintenanceRes.forEach(r => {
          const id = `${r.zone}-${r.row_num}-${r.col_num}`;
          mainMap[id] = r;
        });
      }

      setYearRecords(insMap);
      setMaintenanceRecords(mainMap);
    })
    .catch(console.error)
    .finally(() => setLoading(false));
  }, [currentYear, unitId]);

  // Auto switch back to "before" if "after" data doesn't exist for the current year
  useEffect(() => {
    if (currentYear && !maintenanceYears.includes(currentYear) && viewMode === 'after') {
      setViewMode('before');
    }
  }, [currentYear, maintenanceYears, viewMode]);

  // Autoplay：依 playSteps 序列依序推進
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
          // 同步更新 yearIndex 與 viewMode
          setCurrentYearIndex(playSteps[next].yi);
          setViewMode(playSteps[next].vm);
          return next;
        });
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    }
  }, [isPlaying, playSteps]);

  // 主渲染函數（實際畫布工作）
  const drawCanvas = (blinkVisible: boolean, isPrintMode: boolean = false, isMirrored: boolean = false, annotationText: string = '') => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // 僅在大小變化時才 reset canvas size
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    const width = rect.width;
    const height = rect.height;
    
    if (isPrintMode) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    // 清除全域暫存的 Row 標籤紀錄
    window.__drawnRows = new Set();

    if (tubes.length === 0) return;

    let filteredTubes = tubes;
    if (quadrantFilter !== 'ALL') {
      filteredTubes = tubes.filter(t => t.zone === quadrantFilter);
    }
    if (filteredTubes.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    // rowBounds 以 y 座標 (四捨五入) 為 key，確保每個 y-位置的水平標記各自獨立
    const rowBoundsMap: Record<number, { minX: number, maxX: number, y: number }> = {};

    filteredTubes.forEach(t => {
      if (t.x < minX) minX = t.x;
      if (t.x > maxX) maxX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.y > maxY) maxY = t.y;

      // 用 y 座標取整來分群（相同 row 在不同 zone y 座標會不一樣）
      const yKey = Math.round(t.y * 10);
      if (!rowBoundsMap[yKey]) {
        rowBoundsMap[yKey] = { minX: t.x, maxX: t.x, y: t.y };
      } else {
        if (t.x < rowBoundsMap[yKey].minX) rowBoundsMap[yKey].minX = t.x;
        if (t.x > rowBoundsMap[yKey].maxX) rowBoundsMap[yKey].maxX = t.x;
      }
    });

    const padding = 20;
    const dataWidth = maxX - minX;
    const dataHeight = maxY - minY;
    const scale = Math.min(
      (width - padding * 2) / (dataWidth || 1),
      (height - padding * 2) / (dataHeight || 1)
    );
    const offsetX = width / 2 - ((maxX + minX) / 2) * scale;
    const offsetY = height / 2 - ((maxY + minY) / 2) * scale;

    // 區域分隔線
    ctx.strokeStyle = isPrintMode ? '#cbd5e1' : '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    let lineStartX = offsetX + minX * scale;
    let lineEndX = offsetX + maxX * scale;
    let vLineX = offsetX;
    if (isMirrored) {
      lineStartX = width - lineStartX;
      lineEndX = width - lineEndX;
      vLineX = width - vLineX;
    }

    ctx.moveTo(lineStartX, offsetY);
    ctx.lineTo(lineEndX, offsetY);
    ctx.moveTo(vLineX, offsetY + minY * scale);
    ctx.lineTo(vLineX, offsetY + maxY * scale);
    ctx.stroke();

    const tubeRadius = Math.max(1, scale * 0.36); // 間隙=scale*0.28（原0.4時僅0.2，增加40%）

    // Y axis Row labels - both sides (every 5 rows)
    if (showGridMarkers) {
      const yKeyRowMap: Record<number, number> = {};
      filteredTubes.forEach(t => {
        const yKey = Math.round(t.y * 10);
        if (t.row % 5 === 0) yKeyRowMap[yKey] = t.row;
      });

      const drawRowLabel = (labelX: number, toX: number, cy: number, rowNum: number, alignRight: boolean) => {
        ctx.fillStyle = isPrintMode ? '#1e3a5f' : '#94a3b8';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = alignRight ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(rowNum.toString(), labelX + (alignRight ? -5 : 5), cy);
        ctx.strokeStyle = isPrintMode ? '#94a3b8' : '#475569';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(labelX, cy); ctx.lineTo(toX, cy); ctx.stroke();
        ctx.setLineDash([]);
      };

      Object.keys(rowBoundsMap).forEach(yKeyStr => {
        const yKey = parseInt(yKeyStr, 10);
        const row = yKeyRowMap[yKey];
        if (!row) return;
        const bounds = rowBoundsMap[yKey];
        const cy = offsetY + bounds.y * scale;

        if (isMirrored) {
          const rLX = width - (offsetX + minX * scale) + 50;
          drawRowLabel(rLX, width - (offsetX + bounds.maxX * scale) + tubeRadius + 4, cy, row, false);
          const lLX = width - (offsetX + maxX * scale) - 50;
          drawRowLabel(lLX, width - (offsetX + bounds.minX * scale) - (tubeRadius + 4), cy, row, true);
        } else {
          const lLX = offsetX + minX * scale - 50;
          drawRowLabel(lLX, offsetX + bounds.minX * scale - (tubeRadius + 4), cy, row, true);
          const rLX = offsetX + maxX * scale + 50;
          drawRowLabel(rLX, offsetX + bounds.maxX * scale + tubeRadius + 4, cy, row, false);
        }
      });
    }

    // ACZ 輪廓標記（先畫，管束圓點後覆蓋在上）
    const aczZones: ('IL' | 'IR')[] = [];
    if (quadrantFilter === 'ALL' || quadrantFilter === 'IL') aczZones.push('IL');
    if (quadrantFilter === 'ALL' || quadrantFilter === 'IR') aczZones.push('IR');
    if (aczZones.length > 0) drawACZOverlay(ctx, aczZones, offsetX, offsetY, scale, false, width, isPrintMode);

    filteredTubes.forEach(tube => {
      let cx = offsetX + tube.x * scale;
      if (isMirrored) {
        cx = width - cx;
      }
      const cy = offsetY + tube.y * scale;

      const record = yearRecords[tube.id];
      const maintenance = maintenanceRecords[tube.id];
      const code = record?.code || '';

      let color = '#334155'; // default empty
      let isBlink = false;
      let isPlugged = false; // 提升至外層，供繪 X 使用
      let isOldPlug = false; // 舊塞管標記（灰色圓 + 紅X）
      
      if (record) {
        isPlugged = code === 'PLG';
        let depth = record.size_val || 0;

        if (viewMode === 'after') {
          if (maintenance) {
            if (maintenance.action === 'PLG') {
              isPlugged = true;
            } else if (maintenance.action === 'RPL') {
              isPlugged = false;
              depth = 0;
            }
          } else {
            if (depth > 50) isPlugged = true;
            if (code === 'COR') isPlugged = true;
          }
        }

        let isHighlighted = false;
        if (highlightTubes) {
          isHighlighted = highlightTubes.has(tube.id);
        }

        if (isPlugged) {
          color = '#64748b';
        } else if (code === 'OBS') {
          color = '#2563eb';
          isBlink = true;
        } else if (code === 'COR') {
          color = '#ff3fa4';
          isBlink = true;
        } else if (code === 'BLK' || code === 'RST') {
          color = '#ffffff';
          isBlink = true;
        } else {
          if (depth <= 20) color = '#10b981';
          else if (depth <= 40) color = '#84cc16';
          else if (depth <= 60) color = '#eab308';
          else if (depth <= 80) color = '#f97316';
          else color = '#ef4444';
        }

        // 處置顏色覆蓋（在 highlightTubes 模式且為篩選清單管子且 showDisposalColors 開啟時）
        if (showDisposalColors && highlightTubes && isHighlighted) {
          const mRec = maintenanceRecords[tube.id];
          if (mRec?.action === 'RPL') { color = '#ef4444'; isBlink = false; } // 換管 - 紅色
          else if (mRec?.action === 'PLG') { color = '#e879f9'; isBlink = false; } // 塞管 - 紫粉色
        }

        if (highlightTubes && !isHighlighted) {
           if (showGridMarkers && tube.col % 5 === 0) {
             color = isPrintMode ? '#3b82f6' : '#cbd5e1'; // 列印模式改為鮮明藍色
           } else {
             color = isPrintMode ? '#e2e8f0' : '#1e293b'; // 列印模式改為淡灰色
           }
           isBlink = false; // 未強調管絕對不能閃爍
        }
      } else if (registryRecords[tube.id]?.status === 'plugged') {
        // 舊塞管：showDisposalColors && showOldPlugs 同時 ON → 灰色圓 + 紅X，否則融入背景
        const showOldPlugStyle = showDisposalColors && showOldPlugs;
        color = isPrintMode ? '#cbd5e1' : (showOldPlugStyle ? '#64748b' : '#1e293b');
        if (showOldPlugStyle) isOldPlug = true;
        let isHighlighted = highlightTubes ? highlightTubes.has(tube.id) : false;
        if (highlightTubes && !isHighlighted) {
           color = (showGridMarkers && tube.col % 5 === 0)
             ? (isPrintMode ? '#3b82f6' : '#cbd5e1')
             : (isPrintMode ? '#e2e8f0' : '#1e293b');
           isOldPlug = false;
        }
      } else {
        // 列印模式下無資料管呈淡灰
        color = isPrintMode ? '#d1d5db' : '#334155';
        let isHighlighted = highlightTubes ? highlightTubes.has(tube.id) : false;
        if (highlightTubes && !isHighlighted) {
           color = (showGridMarkers && tube.col % 5 === 0) 
             ? (isPrintMode ? '#3b82f6' : '#cbd5e1') 
             : (isPrintMode ? '#e2e8f0' : '#1e293b');
        }
      }

      // 閃爍定律：這幀 frame 若是隱居相則不畫
      if (isBlink && !blinkVisible) return;

      if (record && code === 'DNT') {
          let isHighlighted = highlightTubes ? highlightTubes.has(tube.id) : false;
          if (highlightTubes && !isHighlighted) {
            // 在篩選強調節點模式中且未被強調，畫為一般黯淡灰圈 或 網格線
            ctx.fillStyle = (showGridMarkers && tube.col % 5 === 0) 
              ? (isPrintMode ? '#3b82f6' : '#cbd5e1') 
              : (isPrintMode ? '#e2e8f0' : '#1e293b');
            ctx.beginPath();
            ctx.arc(cx, cy, tubeRadius, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // 管凹陷 (DNT)：外圈標準藍色，內圓依深度
            let innerColor = '#10b981';
            const depth = record.size_val || 0;
            if (depth <= 20) innerColor = '#10b981';
            else if (depth <= 40) innerColor = '#84cc16';
            else if (depth <= 60) innerColor = '#eab308';
            else if (depth <= 80) innerColor = '#f97316';
            else innerColor = '#ef4444';

            ctx.fillStyle = '#2563eb'; // 標準藍色外圈
            ctx.beginPath();
            ctx.arc(cx, cy, tubeRadius, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = innerColor; // 內圓依深度 (稍微縮小讓外圈變細)
            ctx.beginPath();
            ctx.arc(cx, cy, tubeRadius * 0.85, 0, Math.PI * 2);
            ctx.fill();
          }
      } else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(cx, cy, tubeRadius, 0, Math.PI * 2);
          ctx.fill();
      }

      // 已塞管 / 舊塞管：疊加紅色 X 標記
      if ((isPlugged || isOldPlug) && color !== '#1e293b') {
        const xSize = tubeRadius * 0.55;
        const xLW = Math.max(1, tubeRadius * 0.35);
        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = xLW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - xSize, cy - xSize);
        ctx.lineTo(cx + xSize, cy + xSize);
        ctx.moveTo(cx + xSize, cy - xSize);
        ctx.lineTo(cx - xSize, cy + xSize);
        ctx.stroke();
        ctx.restore();
      }

      if (hoveredTube && hoveredTube.id === tube.id) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, tubeRadius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    if (annotationText) {
      // 確保文字在列印模式下清楚可見（深色 on 白底）
      const textColor = isPrintMode ? '#0f172a' : '#f1f5f9';
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(annotationText, 18, 14);
      ctx.restore();
    }
  };

  // 動畫迴圈 (requestAnimationFrame) - 效能優化版
  useEffect(() => {
    // 依賴改變時主動重新繪製一次
    drawCanvas(blinkPhaseRef.current);

    const loop = (timestamp: number) => {
      // 每 500ms 切換一次閃爍相位
      if (timestamp - lastBlinkTime.current > BLINK_INTERVAL) {
        blinkPhaseRef.current = !blinkPhaseRef.current;
        lastBlinkTime.current = timestamp;
        // 唯有閃爍階段改變時才重新繪製，而不是每秒畫 60 次
        drawCanvas(blinkPhaseRef.current);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tubes, quadrantFilter, yearRecords, maintenanceRecords, registryRecords, hoveredTube, viewMode, highlightTubes, showGridMarkers, showDisposalColors, showOldPlugs]);


  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x: e.clientX, y: e.clientY });

    if (tubes.length === 0) return;

    let filteredTubes = tubes;
    if (quadrantFilter !== 'ALL') {
      filteredTubes = tubes.filter(t => t.zone === quadrantFilter);
    }
    if (filteredTubes.length === 0) {
      setHoveredTube(null);
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    filteredTubes.forEach(t => {
      if (t.x < minX) minX = t.x;
      if (t.x > maxX) maxX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.y > maxY) maxY = t.y;
    });

    const padding = 20;
    const dataWidth = maxX - minX;
    const dataHeight = maxY - minY;
    
    const scale = Math.min(
      (rect.width - padding * 2) / (dataWidth || 1),
      (rect.height - padding * 2) / (dataHeight || 1)
    );

    const offsetX = rect.width / 2 - ((maxX + minX) / 2) * scale;
    const offsetY = rect.height / 2 - ((maxY + minY) / 2) * scale;

    let closest: any | null = null;
    let minDist = Infinity;

    filteredTubes.forEach(tube => {
      const cx = offsetX + tube.x * scale;
      const cy = offsetY + tube.y * scale;
      const dist = Math.sqrt(Math.pow(cx - x, 2) + Math.pow(cy - y, 2));
      
      if (dist < scale && dist < minDist) {
        minDist = dist;
        closest = tube;
      }
    });

    setHoveredTube(closest);
  };

  const handleQuadrantChange = (q: string) => {
    if (q === quadrantFilter) return;
    setIsRendering(true);
    setTimeout(() => {
      setQuadrantFilter(q);
      setTimeout(() => { setIsRendering(false); }, 400);
    }, 50);
  };

  const handleToggleGridMarkers = () => {
    setIsRendering(true);
    setTimeout(() => {
      setShowGridMarkers(prev => !prev);
      setTimeout(() => { setIsRendering(false); }, 400);
    }, 50);
  };

  // 快速上傳處置 Modal
  const handleUploadDisposal = async (records: any[], pass = '') => {
    if (!currentYear) return;
    setUploadStatus('uploading');
    setUploadMessage(`正在上傳 ${records.length} 筆處置計畫...`);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/maintenance/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records, password: pass, unit_id: unitId, year: currentYear })
      });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 403 && result.requirePassword) {
          setUploadStatus('password_required');
          setUploadMessage(result.error || '覆寫需要密碼');
          return;
        }
        throw new Error(result.error || 'Server error');
      }
      setUploadStatus('success');
      setUploadMessage(`成功！${result.message}`);
      setPendingUploadRecords([]);
      setUploadPassword('');
      // 重新載入處置資料
      if (currentYear) {
        fetch(`${import.meta.env.BASE_URL}api/maintenance?unit_id=${unitId}&year=${currentYear}`)
          .then(r => r.json()).then(rows => {
            const map: Record<string, any> = {};
            if (Array.isArray(rows)) rows.forEach(r => { map[`${r.zone}-${r.row_num}-${r.col_num}`] = r; });
            setMaintenanceRecords(map);
            setMaintenanceYears(prev => prev.includes(currentYear) ? prev : [...prev, currentYear]);
          });
      }
    } catch (err: any) {
      setUploadStatus('error');
      setUploadMessage(`上傳失敗: ${err.message}`);
    }
  };

  const handleModalFileUpload = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    setUploadStatus('uploading');
    setUploadMessage('解析檔案中...');
    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws) as any[];
          setPendingUploadRecords(rows);
          setUploadStatus('idle');
          setUploadMessage(`已讀取 ${rows.length} 筆，請點擊確認上傳`);
        } catch { setUploadStatus('error'); setUploadMessage('檔案解析失敗'); }
      };
      reader.readAsBinaryString(file);
    } else {
      setUploadStatus('error');
      setUploadMessage('請上傳 .xlsx 格式');
    }
  };

  const handleDownloadTemplate = () => {
    if (!highlightTubes || !currentYear) return;
    const rows = Array.from(highlightTubes).map(id => {
      const parts = id.split('-');
      return {
        '機組/Unit': unitId,
        '年份': currentYear,
        '區域/Zone': parts[0],
        '行/Row': parts[1],
        '列/Col': parts[2],
        '處置/action': '',
        '新材質/new_material': '',
        '備註/notes': ''
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '處置計畫');
    XLSX.writeFile(wb, `disposal-template-${unitId}-${currentYear}.xlsx`);
  };

  const handleDownloadImage = () => {
    const quadrantsDesc = quadrantFilter === 'ALL' ? '全部' : quadrantFilter;
    const filterMode = highlightTubes ? 'filtered' : 'full';
    const mainCanvas = canvasRef.current;
    if (!mainCanvas) return;

    const W = mainCanvas.clientWidth;
    const H = mainCanvas.clientHeight;

    const renderOffscreen = (mirrored: boolean, label: string): string => {
      const off = document.createElement('canvas');
      off.width = W * 2; off.height = H * 2;
      const oc = off.getContext('2d');
      if (!oc) return '';
      oc.scale(2, 2);

      // white background
      oc.fillStyle = '#ffffff';
      oc.fillRect(0, 0, W, H);

      let fTubes = tubes;
      if (quadrantFilter !== 'ALL') fTubes = tubes.filter(t => t.zone === quadrantFilter);
      if (!fTubes.length) return '';

      let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
      const rBM: Record<number, {minX:number,maxX:number,y:number}> = {};
      fTubes.forEach(t => {
        if (t.x < mnX) mnX = t.x; if (t.x > mxX) mxX = t.x;
        if (t.y < mnY) mnY = t.y; if (t.y > mxY) mxY = t.y;
        const yk = Math.round(t.y * 10);
        if (!rBM[yk]) rBM[yk] = {minX:t.x,maxX:t.x,y:t.y};
        else { if (t.x < rBM[yk].minX) rBM[yk].minX=t.x; if (t.x > rBM[yk].maxX) rBM[yk].maxX=t.x; }
      });

      const pad = 20;
      const sc = Math.min((W-pad*2)/((mxX-mnX)||1),(H-pad*2)/((mxY-mnY)||1));
      const ox = W/2-((mxX+mnX)/2)*sc;
      const oy = H/2-((mxY+mnY)/2)*sc;
      const tr = Math.max(1, sc * 0.36);

      // row labels
      if (showGridMarkers) {
        const ykMap: Record<number,number> = {};
        fTubes.forEach(t => { const yk=Math.round(t.y*10); if (t.row%5===0) ykMap[yk]=t.row; });
        const dl = (lx:number,tx:number,cy:number,rn:number,ar:boolean) => {
          oc.fillStyle='#1e3a5f'; oc.font='bold 11px sans-serif';
          oc.textAlign=ar?'right':'left'; oc.textBaseline='middle';
          oc.fillText(rn.toString(),lx+(ar?-5:5),cy);
          oc.strokeStyle='#94a3b8'; oc.lineWidth=0.8;
          oc.setLineDash([3,3]); oc.beginPath(); oc.moveTo(lx,cy); oc.lineTo(tx,cy); oc.stroke();
          oc.setLineDash([]);
        };
        Object.keys(rBM).forEach(yks => {
          const yk=parseInt(yks,10); const row=ykMap[yk]; if (!row) return;
          const b=rBM[yk]; const cy=oy+b.y*sc;
          if (mirrored) {
            dl(W-(ox+mnX*sc)+50, W-(ox+b.maxX*sc)+tr+4, cy, row, false);
            dl(W-(ox+mxX*sc)-50, W-(ox+b.minX*sc)-(tr+4), cy, row, true);
          } else {
            dl(ox+mnX*sc-50, ox+b.minX*sc-(tr+4), cy, row, true);
            dl(ox+mxX*sc+50, ox+b.maxX*sc+tr+4, cy, row, false);
          }
        });
      }

      // ACZ 輪廓標記（列印版，先畫讓管束覆蓋）
      const aczZ: ('IL' | 'IR')[] = [];
      if (quadrantFilter==='ALL'||quadrantFilter==='IL') aczZ.push('IL');
      if (quadrantFilter==='ALL'||quadrantFilter==='IR') aczZ.push('IR');
      if (aczZ.length > 0) drawACZOverlay(oc as any, aczZ, ox, oy, sc, mirrored, W, true);

      // tubes
      fTubes.forEach(tube => {
        let cx = ox + tube.x * sc;
        if (mirrored) cx = W - cx;
        const cy = oy + tube.y * sc;
        const rec = yearRecords[tube.id];
        const maint = maintenanceRecords[tube.id];
        const code = rec?.code || '';
        let color = '#d1d5db';
        let isPlg = false; // 提升至外層
        if (rec) {
          isPlg = code==='PLG'; let depth=rec.size_val||0;
          if (viewMode==='after') {
            if (maint) { if (maint.action==='PLG') isPlg=true; else if (maint.action==='RPL'){isPlg=false;depth=0;} }
            else { if (depth>50) isPlg=true; if (code==='COR') isPlg=true; }
          }
          const isHL = highlightTubes?highlightTubes.has(tube.id):false;
          if (isPlg) color='#cbd5e1';
          else if (code==='OBS') color='#2563eb';
          else if (code==='COR') color='#ff3fa4';
          else if (code==='BLK'||code==='RST') color='#94a3b8';
          else { if (depth<=20) color='#10b981'; else if (depth<=40) color='#84cc16'; else if (depth<=60) color='#eab308'; else if (depth<=80) color='#f97316'; else color='#ef4444'; }
          // 處置顏色覆蓋（showDisposalColors ON 且為篩選清單管子）
          if (showDisposalColors && highlightTubes && isHL) {
            if (maint?.action==='RPL') { color='#ef4444'; } // 換管 - 紅色
            else if (maint?.action==='PLG') { color='#e879f9'; } // 塞管 - 紫粉色
          }
          if (highlightTubes&&!isHL) color=(showGridMarkers&&tube.col%5===0)?'#3b82f6':'#e2e8f0';
        } else if (registryRecords[tube.id]?.status==='plugged') {
          // 舊塞管：showDisposalColors && showOldPlugs → 灰色圓 + 紅X，否則淡灰
          const showOldStyle = showDisposalColors && showOldPlugs;
          const skipByHL = highlightTubes && !highlightTubes.has(tube.id);
          color = skipByHL
            ? ((showGridMarkers&&tube.col%5===0)?'#3b82f6':'#e2e8f0')
            : (showOldStyle ? '#64748b' : '#cbd5e1');
          const drawOldX = showOldStyle && !skipByHL;
          oc.fillStyle=color; oc.beginPath(); oc.arc(cx,cy,tr,0,Math.PI*2); oc.fill();
          if (drawOldX) {
            const xs=tr*0.55; const xlw=Math.max(0.8,tr*0.35);
            oc.save(); oc.strokeStyle='#dc2626'; oc.lineWidth=xlw; oc.lineCap='round';
            oc.beginPath(); oc.moveTo(cx-xs,cy-xs); oc.lineTo(cx+xs,cy+xs);
            oc.moveTo(cx+xs,cy-xs); oc.lineTo(cx-xs,cy+xs); oc.stroke(); oc.restore();
          }
          return; // 舊塞管已自行繪製，跳過後續公用邏輯
        } else {
          color='#d1d5db';
          if (highlightTubes&&!highlightTubes.has(tube.id)) color=(showGridMarkers&&tube.col%5===0)?'#3b82f6':'#e2e8f0';
        }
        if (rec&&code==='DNT') {
          const isHL=highlightTubes?highlightTubes.has(tube.id):false;
          if (highlightTubes&&!isHL) {
            oc.fillStyle=(showGridMarkers&&tube.col%5===0)?'#3b82f6':'#e2e8f0';
            oc.beginPath(); oc.arc(cx,cy,tr,0,Math.PI*2); oc.fill();
          } else {
            const d=rec.size_val||0; let ic='#10b981';
            if (d<=20) ic='#10b981'; else if (d<=40) ic='#84cc16'; else if (d<=60) ic='#eab308'; else if (d<=80) ic='#f97316'; else ic='#ef4444';
            oc.fillStyle='#2563eb'; oc.beginPath(); oc.arc(cx,cy,tr,0,Math.PI*2); oc.fill();
            oc.fillStyle=ic; oc.beginPath(); oc.arc(cx,cy,tr*0.85,0,Math.PI*2); oc.fill();
          }
        } else {
          oc.fillStyle=color; oc.beginPath(); oc.arc(cx,cy,tr,0,Math.PI*2); oc.fill();
        }
        // 已塞管：疊加紅色 X（列印版）
        if (isPlg) {
          const xs = tr * 0.55; const xlw = Math.max(0.8, tr * 0.35);
          oc.save(); oc.strokeStyle='#dc2626'; oc.lineWidth=xlw; oc.lineCap='round';
          oc.beginPath(); oc.moveTo(cx-xs,cy-xs); oc.lineTo(cx+xs,cy+xs);
          oc.moveTo(cx+xs,cy-xs); oc.lineTo(cx-xs,cy+xs); oc.stroke(); oc.restore();
        }
      });

      // title
      oc.save(); oc.fillStyle='#0f172a'; oc.font='bold 26px sans-serif';
      oc.textAlign='left'; oc.textBaseline='top'; oc.fillText(label,18,14); oc.restore();

      // LEGEND（處置顏色 ON 時才繪製）
      if (showDisposalColors) {
        type LegendItem = { color: string; label: string; isOldPlug?: boolean };
        const legendItems: LegendItem[] = [
          { color: '#ef4444', label: '換管' },
          { color: '#e879f9', label: '塞管' },
          ...(showOldPlugs ? [{ color: '#64748b', label: '舊塞管', isOldPlug: true }] : []),
        ];
        const dotR = 7;
        const itemW = 80;
        const legendW = legendItems.length * itemW + 16;
        const legendH = 32;
        const lx = W - legendW - 12;
        const ly = H - legendH - 12;

        // 背景
        oc.save();
        oc.fillStyle = 'rgba(15,23,42,0.75)';
        oc.beginPath();
        (oc as any).roundRect?.(lx, ly, legendW, legendH, 6) || oc.rect(lx, ly, legendW, legendH);
        oc.fill();

        // 項目
        oc.font = 'bold 12px sans-serif';
        oc.textBaseline = 'middle';
        legendItems.forEach((item, i) => {
          const ix = lx + 12 + i * itemW;
          const iy = ly + legendH / 2;
          // 圓點
          oc.fillStyle = item.color;
          oc.beginPath();
          oc.arc(ix, iy, dotR, 0, Math.PI * 2);
          oc.fill();
          // 舊塞管：疊加紅色 X
          if (item.isOldPlug) {
            const xs = dotR * 0.6; const xlw = Math.max(0.8, dotR * 0.35);
            oc.strokeStyle = '#dc2626'; oc.lineWidth = xlw; oc.lineCap = 'round';
            oc.beginPath(); oc.moveTo(ix-xs,iy-xs); oc.lineTo(ix+xs,iy+xs);
            oc.moveTo(ix+xs,iy-xs); oc.lineTo(ix-xs,iy+xs); oc.stroke();
          }
          oc.fillStyle = '#f8fafc';
          oc.textAlign = 'left';
          oc.fillText(item.label, ix + dotR + 4, iy);
        });
        oc.restore();
      }

      return off.toDataURL('image/png');
    };

    const download = (url: string, filename: string) => {
      const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
    };

    download(renderOffscreen(false, `${quadrantsDesc}象限 - 西側`), `condenser-${unitId}-${viewMode}-${filterMode}-West-${Date.now()}.png`);
    setTimeout(() => {
      download(renderOffscreen(true, `${quadrantsDesc}象限 - 東側`), `condenser-${unitId}-${viewMode}-${filterMode}-East-${Date.now()}.png`);
    }, 300);
  };

  return (
    <div className="space-y-6">
      {highlightTubes && (
        <div className="bg-indigo-900/40 border border-indigo-700 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-y-2 shadow-lg mb-2">
          <div className="flex items-center gap-3">
            <span className="text-xl">🔍</span>
            <span className="text-indigo-200 font-medium tracking-wide">
              正在檢視篩選清單的重點管束 <span className="font-bold text-white bg-indigo-800 px-2 py-0.5 rounded ml-1">共 {highlightTubes.size} 支</span>
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 情境 A/B 二選一 */}
            {currentYear && !maintenanceYears.includes(currentYear) ? (
              <button
                onClick={() => { setShowUploadModal(true); setUploadStatus('idle'); setUploadMessage(''); setPendingUploadRecords([]); }}
                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-1.5 rounded-md transition"
              >
                <Upload size={15} /> 快速上傳處置方向
              </button>
            ) : (
              <>
                <button
                  onClick={() => setShowDisposalColors(p => !p)}
                  className={`flex items-center gap-2 text-sm font-medium px-4 py-1.5 rounded-md transition ${showDisposalColors ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
                >
                  <Palette size={15} /> 處置顏色 {showDisposalColors ? 'ON' : 'OFF'}
                </button>
                {showDisposalColors && (
                  <button
                    onClick={() => setShowOldPlugs(p => !p)}
                    className={`flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-md transition ${showOldPlugs ? 'bg-slate-600 hover:bg-slate-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}
                  >
                    {showOldPlugs ? <Eye size={14}/> : <EyeOff size={14}/>} 舊塞管
                  </button>
                )}
                {showDisposalColors && (
                  <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800/60 px-3 py-1.5 rounded-md border border-slate-700">
                    <span className="inline-block w-3 h-3 rounded-full bg-red-500"/>換管
                    <span className="inline-block w-3 h-3 rounded-full bg-fuchsia-400 ml-1"/>塞管
                    {showOldPlugs && (
                      <span className="inline-flex items-center gap-1 ml-1">
                        <span className="relative inline-flex items-center justify-center w-3 h-3">
                          <span className="absolute inset-0 rounded-full bg-slate-500"/>
                          <span className="relative text-red-500 font-black" style={{fontSize:'8px',lineHeight:1}}>✕</span>
                        </span>
                        舊塞管
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
            <button
              onClick={handleToggleGridMarkers}
              className={`flex items-center gap-2 text-sm font-medium px-4 py-1.5 rounded-md transition ${showGridMarkers ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
            >
              <Table2 size={16} />
              施工網格 {showGridMarkers ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={handleDownloadImage}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-1.5 rounded-md transition"
              title="匯出列印友善白底圖形"
            >
              <ImageIcon size={16} /> 下載圖紙
            </button>
            <button
              onClick={onClearHighlight}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-1.5 rounded-md transition"
            >
              清除清單狀態
            </button>
          </div>
        </div>
      )}

      {/* 快速上傳處置 Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg p-6 mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2"><Upload size={18} className="text-orange-400"/> 快速上傳處置方向</h3>
              <button onClick={() => setShowUploadModal(false)} className="text-slate-400 hover:text-white"><X size={20}/></button>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              為 <span className="text-white font-bold">{currentYear}</span> 年度大修，上傳共 <span className="text-orange-300 font-bold">{highlightTubes?.size}</span> 支篩選管束的處置計畫。
            </p>

            {/* 下載樣板按鈕 */}
            <button
              onClick={handleDownloadTemplate}
              className="w-full mb-4 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-sm px-4 py-2.5 rounded-lg transition"
            >
              <Download size={15}/> 下載預填樣板 Excel（已帶入管號）
            </button>

            {/* 上傳區域 */}
            <label className="block w-full border-2 border-dashed border-slate-600 hover:border-orange-500 rounded-xl p-6 text-center cursor-pointer transition mb-3">
              <input type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f=e.target.files?.[0]; if(f) handleModalFileUpload(f); e.target.value=''; }}
              />
              <Upload size={28} className="mx-auto mb-2 text-slate-500"/>
              <p className="text-sm text-slate-400">點擊或拖曳 Excel 檔案（.xlsx）</p>
              <p className="text-xs text-slate-600 mt-1">欄位：機組/Unit | 年份 | 區域/Zone | 行/Row | 列/Col | 處置/action | 新材質/new_material | 備註/notes</p>
            </label>

            {pendingUploadRecords.length > 0 && (
              <p className="text-sm text-emerald-400 mb-2">已讀取 {pendingUploadRecords.length} 筆，點擊「確認上傳」執行</p>
            )}

            {uploadStatus === 'password_required' && (
              <div className="flex items-center gap-2 mb-3">
                <Lock size={14} className="text-yellow-400"/>
                <input
                  type="password" placeholder="覆寫密碼" value={uploadPassword}
                  onChange={e => setUploadPassword(e.target.value)}
                  className="flex-1 bg-slate-800 border border-yellow-600 rounded-md px-3 py-1.5 text-sm text-white"
                />
              </div>
            )}

            {uploadMessage && (
              <p className={`text-sm mb-3 ${
                uploadStatus==='success'?'text-emerald-400':
                uploadStatus==='error'?'text-red-400':'text-slate-400'
              }`}>{uploadMessage}</p>
            )}

            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowUploadModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">取消</button>
              <button
                onClick={() => {
                  if (uploadStatus==='password_required') {
                    handleUploadDisposal(pendingUploadRecords, uploadPassword);
                  } else if (pendingUploadRecords.length > 0) {
                    handleUploadDisposal(pendingUploadRecords);
                  }
                }}
                disabled={pendingUploadRecords.length === 0 && uploadStatus !== 'password_required'}
                className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition"
              >
                {uploadStatus==='uploading' ? '上傳中...' : '確認上傳'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            動態視覺檢視 
            <div className="bg-slate-800 text-sm px-3 py-1 rounded-full text-blue-400 border border-blue-900/50 shadow-inner">
              {unitId} - 共有 {tubes.length} 支管
            </div>
          </h2>
          <p className="text-slate-400 mt-1">冷凝器管板形貌映射與狀態演化 ({viewMode === 'before' ? '檢測結果預覽' : '處置後結果預覽'})</p>
        </div>
        
        <div className="flex flex-col items-end gap-3">
          <div className="flex gap-4">
            {/* Quadrant Filter */}
            <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 shadow-inner">
              {['ALL', 'IL', 'IR', 'OL', 'OR'].map(q => (
                <button
                  key={q}
                  onClick={() => handleQuadrantChange(q)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    quadrantFilter === q 
                      ? 'bg-blue-600 text-white shadow' 
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Mode Toggle Button */}
            <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 shadow-inner">
              <button
                onClick={() => setViewMode('before')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  viewMode === 'before' 
                    ? 'bg-blue-600 text-white shadow' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                檢測結果 (Before)
              </button>
              <button
                onClick={() => hasAfterData && setViewMode('after')}
                disabled={!hasAfterData}
                title={!hasAfterData ? "無該年份之大修處置紀錄" : ""}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  !hasAfterData 
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                    : viewMode === 'after' 
                      ? 'bg-emerald-600 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]' 
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                處置後 (After)
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 shadow-sm">
            <LegendItem color="bg-emerald-500" label="0-20%" />
            <LegendItem color="bg-lime-500" label="20-40%" />
            <LegendItem color="bg-yellow-500" label="40-60%" />
            <LegendItem color="bg-orange-500" label="60-80%" />
            <LegendItem color="bg-red-500" label=">80%" />
            <div className="w-px h-4 bg-slate-700 mx-1"></div>
            <PluggedLegendItem label="已塞管" />
            <div className="w-px h-4 bg-slate-700 mx-1"></div>
            <LegendItem color="bg-pink-500" label="COR 氨腐蝕" animate />
            <LegendItem color="bg-white" label="BLK/RST 無法檢測" animate />
            <LegendItem color="bg-blue-600" label="OBS 待觀察" animate />
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-600 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              </div>
              <span className="text-slate-300 ml-1">DNT 管凹陷</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl shadow-sm border border-slate-800 overflow-hidden flex flex-col relative">
        {loading && (
          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center z-40 backdrop-blur-sm">
            <div className="text-blue-400 flex items-center gap-2 font-medium">
              <Layers className="animate-spin" /> 讀取資料中...
            </div>
          </div>
        )}
        
        <div className="bg-slate-900 border-b border-slate-800 p-4 flex items-center gap-6">
          <div className="flex items-center gap-2">
            {/* 跳回第一步 */}
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
            {/* 播放 / 暫停 */}
            <button 
              onClick={() => {
                if (playStepIndex >= playSteps.length - 1) {
                  // 已到末尾：重頭播放
                  setPlayStepIndex(0);
                  setCurrentYearIndex(playSteps[0]?.yi ?? 0);
                  setViewMode(playSteps[0]?.vm ?? 'before');
                }
                setIsPlaying(!isPlaying);
              }}
              className="p-3 bg-blue-600 text-white hover:bg-blue-700 rounded-full transition-colors shadow-sm disabled:opacity-50"
              disabled={playSteps.length === 0}
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
            </button>
            {/* 跳到最後一步 */}
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

          {/* 時間軸：每個 playStep 一個節點 */}
          <div className="flex-1 px-4">
            <div className="relative flex items-center justify-between">
              <div className="absolute left-0 right-0 h-1 bg-slate-800 rounded-full top-[8px] z-0"></div>
              
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
                    {/* 節點圓點：before=藍，after=綠 */}
                    <div className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                      isActive
                        ? (isBefore ? 'bg-blue-500 border-blue-400 scale-125 shadow-[0_0_8px_rgba(59,130,246,0.7)]' : 'bg-emerald-500 border-emerald-400 scale-125 shadow-[0_0_8px_rgba(16,185,129,0.7)]')
                        : isPast
                          ? (isBefore ? 'bg-blue-900 border-blue-700' : 'bg-emerald-900 border-emerald-700')
                          : 'bg-slate-800 border-slate-600 group-hover:border-blue-500'
                    }`}></div>
                    {/* 標籤：年份（before 才顯示）+ 檢測/處置 */}
                    <div className="absolute top-6 flex flex-col items-center gap-0.5">
                      {isBefore && (
                        <span className={`text-xs font-bold whitespace-nowrap ${
                          isActive ? 'text-blue-300' : isPast ? 'text-slate-500' : 'text-slate-600'
                        }`}>{year}</span>
                      )}
                      <span className={`text-[10px] whitespace-nowrap px-1.5 py-0.5 rounded-full font-medium ${
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
              
              {playSteps.length === 0 && (
                <div className="text-slate-500 text-sm italic py-2">無歷史年份資料，請先匯入</div>
              )}
            </div>
          </div>

          {/* 右側顯示目前年份與模式 */}
          <div className="text-right min-w-[110px]">
            <div className="text-sm text-slate-400">顯示年份</div>
            <div className="text-2xl font-bold text-white">{currentYear || '----'}</div>
            <div className={`text-xs mt-0.5 font-medium ${
              viewMode === 'before' ? 'text-blue-400' : 'text-emerald-400'
            }`}>
              {viewMode === 'before' ? '大修檢測' : '大修處置'}
            </div>
          </div>
        </div>

        <div className="relative w-full h-[650px] bg-slate-950">
          <canvas 
            ref={canvasRef} 
            className="w-full h-full cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredTube(null)}
          />
          
          {isRendering && (
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm z-10 flex flex-col items-center justify-center transition-opacity duration-300">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
              <span className="text-blue-400 font-medium text-lg tracking-wider">切換視圖中...</span>
            </div>
          )}

          {hoveredTube && (
            <div 
              className="fixed z-50 bg-slate-800 border border-slate-700 text-slate-200 p-4 rounded-lg shadow-xl text-sm pointer-events-none transform -translate-x-1/2 -translate-y-full mt-[-10px] min-w-[280px]"
              style={{ left: mousePos.x, top: mousePos.y }}
            >
              <div className="font-bold text-base mb-2 border-b border-slate-700 pb-1 text-white flex justify-between">
                <span>位置: {hoveredTube.zone} / 行 {hoveredTube.row} / 列 {hoveredTube.col}</span>
                <span className="text-xs px-2 py-0.5 bg-slate-700 rounded-full text-slate-300">{unitId}</span>
              </div>
              
              {/* Registry Info */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3 border-b border-slate-700 pb-2">
                <span className="text-slate-400">目前材質:</span>
                <span className="text-yellow-100">{registryRecords[hoveredTube.id]?.material || '黃銅 (預設)'}</span>
                
                <span className="text-slate-400">目前管齡:</span>
                <span>
                  {registryRecords[hoveredTube.id]?.tube_age !== undefined 
                    ? `${registryRecords[hoveredTube.id].tube_age} 年` 
                    : '未知 (缺安裝年)'}
                </span>
                
                <span className="text-slate-400">歷史狀態:</span>
                <span>{registryRecords[hoveredTube.id]?.status === 'plugged' ? '已塞管' : '正常'}</span>
              </div>
              
              <div className="pt-1">
                <div className="font-semibold mb-1 text-blue-400 leading-none">檢測結果 ({currentYear || '無'})</div>
                {yearRecords[hoveredTube.id] ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm bg-slate-900/50 p-2 rounded">
                    <span className="text-slate-400">瑕疵碼:</span>
                    <span className="font-mono text-blue-300">{yearRecords[hoveredTube.id].code}</span>
                    <span className="text-slate-400">深度 (%):</span>
                    <span className="font-bold">{yearRecords[hoveredTube.id].size_val?.toFixed(1) || '0.0'}</span>
                    
                    {viewMode === 'after' && (
                      <>
                         <span className="text-slate-400 mt-1">實際處置:</span>
                         <span className={`font-mono mt-1 font-bold ${maintenanceRecords[hoveredTube.id]?.action ? 'text-emerald-400' : 'text-slate-500'}`}>
                           {maintenanceRecords[hoveredTube.id]?.action || '無特別處置'}
                         </span>
                      </>
                    )}

                    {viewMode === 'before' && (
                      <>
                        <span className="text-slate-400">防呆判定:</span>
                        <span className="font-medium text-emerald-400">
                          {(yearRecords[hoveredTube.id].size_val > 50 || yearRecords[hoveredTube.id].code === 'COR' || yearRecords[hoveredTube.id].code === 'PLG') ? <span className="text-slate-400 text-xs">需換/塞管</span> : '正常'}
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-slate-500 italic p-2 text-xs">此年份無檢測紀錄</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PluggedLegendItem({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative w-3 h-3">
        {/* 灰色圓底 */}
        <div className="w-3 h-3 rounded-full bg-slate-500 absolute inset-0" />
        {/* 紅色 X */}
        <svg viewBox="0 0 12 12" className="absolute inset-0 w-3 h-3" xmlns="http://www.w3.org/2000/svg">
          <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
          <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <span className="text-slate-300">{label}</span>
    </div>
  );
}

function LegendItem({ color, label, animate = false }: { color: string, label: string, animate?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-3 h-3 rounded-full ${color} ${animate ? 'animate-pulse' : ''}`}></div>
      <span className="text-slate-300">{label}</span>
    </div>
  );
}
