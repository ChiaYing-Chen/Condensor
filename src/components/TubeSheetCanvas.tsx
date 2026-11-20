import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Layers, Loader2, Download, Table2, Image as ImageIcon, Upload, Palette, Eye, EyeOff, X, Lock, Pencil, ShieldCheck, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { generateTubeMap } from '../utils/tubeMapGenerator';
import { VisualHighlightRequest, VisualListMode } from '../types';
import { normalizeMaintAction, isDisposalAction, formatMaintActionLabel } from '../utils/maintenanceAction';
import { fetchCurrentUserPermission } from '../utils/userPermission';

const INSPECTION_CODE_OPTIONS = [
  { code: 'NDD', label: 'NDD - 無缺陷' },
  { code: 'PIT', label: 'PIT - 內部孔蝕' },
  { code: 'COR', label: 'COR - 外部氨腐蝕' },
  { code: 'DNT', label: 'DNT - 管凹陷' },
  { code: 'PLG', label: 'PLG - 塞管' },
  { code: 'BLK', label: 'BLK - 堵管' },
  { code: 'RST', label: 'RST - 無法檢測' },
  { code: 'OBS', label: 'OBS - 待觀察' },
] as const;

function splitSystemDntNote(rawNote?: string | null): { systemDntTag: string; userNote: string } {
  if (!rawNote) return { systemDntTag: '', userNote: '' };
  const segments = rawNote.split(/;\s*/).map(s => s.trim()).filter(Boolean);
  const dntSegments = segments.filter(s => /^也檢測到.*DNT/i.test(s));
  const userSegments = segments.filter(s => !/^也檢測到.*DNT/i.test(s));
  return {
    systemDntTag: dntSegments.join('; '),
    userNote: userSegments.join('; ')
  };
}

function buildCombinedBeforeNote(systemDntTag: string, userNote: string): string {
  const cleanUser = userNote.trim();
  if (systemDntTag && cleanUser) return `${cleanUser}; ${systemDntTag}`;
  if (systemDntTag) return systemDntTag;
  return cleanUser;
}

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
  highlightConfig?: VisualHighlightRequest | null;
  /** 由處置篩選系統傳入：本次篩選的目標年份，用於時間軸閃爍定位 */
  filterSourceYear?: number | null;
  /** 由處置篩選系統傳入：基準比對年份，用於時間軸閃爍定位 */
  filterBaseYear?: number | null;
  onClearHighlight?: () => void;
}

export default function TubeSheetCanvas({ unitId, highlightTubes, highlightConfig, filterSourceYear, filterBaseYear, onClearHighlight }: TubeSheetCanvasProps) {
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
  const [showDisposalColors, setShowDisposalColors] = useState(Boolean(highlightConfig?.enableDisposalColors));
  const [showOldPlugs, setShowOldPlugs] = useState(false);
  const [showDNTOnly, setShowDNTOnly] = useState(false);
  const [visualListMode, setVisualListMode] = useState<VisualListMode>(highlightConfig?.mode || 'suggested');
  // 快速上傳 Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle'|'uploading'|'success'|'error'|'password_required'>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadPassword, setUploadPassword] = useState('');
  const [uploadExistingNotesCount, setUploadExistingNotesCount] = useState(0);
  const [uploadNotesMode, setUploadNotesMode] = useState<'merge' | 'overwrite'>('merge');
  const [pendingUploadRecords, setPendingUploadRecords] = useState<any[]>([]);

  // 單支管備註編輯 Modal 與 Hover 緩衝
  const isTooltipHoveredRef = useRef(false);
  const hoverHideTimerRef = useRef<number | null>(null);
  const noteDialogRef = useRef<HTMLDialogElement>(null);
  const beforeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const afterTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [editingTarget, setEditingTarget] = useState<{
    tube: any;
    year: number;
    hasAfter: boolean;
    activeMode: ViewMode;
    systemDntTag: string;
    origCode: string;
    origDepth: number;
  } | null>(null);
  const [editCode, setEditCode] = useState('NDD');
  const [editDepth, setEditDepth] = useState('0');
  const [editBeforeNote, setEditBeforeNote] = useState('');
  const [editAfterNote, setEditAfterNote] = useState('');
  const [confirmingValueChange, setConfirmingValueChange] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaveError, setNoteSaveError] = useState('');
  const [currentUserInfo, setCurrentUserInfo] = useState<{
    userId: string;
    userName: string;
    isAdmin: boolean;
  }>({ userId: '', userName: '訪客', isAdmin: false });

  // 閨牍動畫相關 ref
  const blinkPhaseRef = useRef<boolean>(true); // true = 顯示, false = 隱藏
  const rafRef = useRef<number>(0);
  const lastBlinkTime = useRef<number>(0);
  const BLINK_INTERVAL = 500; // ms

  // Generate tubes once
  const tubes = useMemo(() => generateTubeMap(), []);

  const currentYear = availableYears.length > 0 ? availableYears[currentYearIndex] : null;
  const hasAfterData = currentYear ? maintenanceYears.includes(currentYear) : false;

  const suggestedTubeSet = useMemo(() => {
    if (highlightConfig?.suggestedIds && highlightConfig.suggestedIds.length > 0) {
      return new Set<string>(highlightConfig.suggestedIds);
    }
    if (highlightConfig?.origin !== 'import' && highlightTubes && highlightTubes.size > 0) {
      return highlightTubes;
    }
    return new Set<string>();
  }, [highlightConfig, highlightTubes]);

  const { finalTubeSet, finalActionCounts } = useMemo(() => {
    const set = new Set<string>();
    let rpl = 0;
    let plg = 0;
    Object.entries(maintenanceRecords).forEach(([id, rec]) => {
      const act = normalizeMaintAction(rec?.action);
      if (act === 'RPL') {
        set.add(id);
        rpl++;
      } else if (act === 'PLG') {
        set.add(id);
        plg++;
      }
    });
    if (
      set.size === 0 &&
      highlightConfig?.finalIds &&
      highlightConfig.finalIds.length > 0 &&
      currentYear === highlightConfig.sourceYear
    ) {
      highlightConfig.finalIds.forEach(id => set.add(id));
    }
    return { finalTubeSet: set, finalActionCounts: { rpl, plg } };
  }, [maintenanceRecords, highlightConfig, currentYear]);

  const diffBreakdown = useMemo(() => {
    let matched = 0;
    let added = 0;
    let kept = 0;
    suggestedTubeSet.forEach(id => {
      if (finalTubeSet.has(id)) matched++;
      else kept++;
    });
    finalTubeSet.forEach(id => {
      if (!suggestedTubeSet.has(id)) added++;
    });
    return { matched, added, kept };
  }, [suggestedTubeSet, finalTubeSet]);

  const activeHighlightSet = useMemo<Set<string> | null>(() => {
    if (!highlightTubes && !highlightConfig) return null;
    if (visualListMode === 'final') return finalTubeSet;
    if (visualListMode === 'diff') {
      const union = new Set<string>(suggestedTubeSet);
      finalTubeSet.forEach(id => union.add(id));
      return union;
    }
    return suggestedTubeSet.size > 0 ? suggestedTubeSet : (highlightTubes || null);
  }, [highlightTubes, highlightConfig, visualListMode, suggestedTubeSet, finalTubeSet]);

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

  const jumpToYearMode = (targetYear: number, preferredMode: ViewMode) => {
    const yi = availableYears.indexOf(targetYear);
    if (yi < 0) return;
    const vm: ViewMode = preferredMode === 'after' && maintenanceYears.includes(targetYear) ? 'after' : 'before';
    const si = playSteps.findIndex(s => s.yi === yi && s.vm === vm);
    setIsPlaying(false);
    setCurrentYearIndex(yi);
    setViewMode(vm);
    if (si >= 0) setPlayStepIndex(si);
  };

  // Initialize: Fetch available years and tube registry for this unit
  useEffect(() => {
    if (!unitId) return;

    setLoading(true);
    setCurrentYearIndex(0);
    setPlayStepIndex(0);
    setViewMode('before');
    setAvailableYears([]);
    setIsPlaying(false);

    Promise.all([
      fetch(`${import.meta.env.BASE_URL}api/years?unit_id=${unitId}`).then(res => res.json()),
      fetch(`${import.meta.env.BASE_URL}api/tubes?unit_id=${unitId}`).then(res => res.json()),
      fetch(`${import.meta.env.BASE_URL}api/maintenance/years?unit_id=${unitId}`).then(res => res.json())
    ]).then(([years, tubesRegistry, mainYears]) => {
      let sortedYears: number[] = [];
      if (Array.isArray(years)) {
        sortedYears = years.sort((a,b) => a - b);
        setAvailableYears(sortedYears);
      }
      
      let mYears: number[] = [];
      if (Array.isArray(mainYears)) {
        mYears = mainYears;
        setMaintenanceYears(mYears);
      }
      
      if (sortedYears.length > 0) {
        const preferredYear = highlightConfig?.sourceYear ?? filterSourceYear;
        const targetYi = preferredYear && sortedYears.includes(preferredYear)
          ? sortedYears.indexOf(preferredYear)
          : sortedYears.length - 1;
        const targetYear = sortedYears[targetYi];
        const hasMaint = mYears.includes(targetYear);
        const targetVm: ViewMode = hasMaint ? 'after' : 'before';

        const steps: Array<{ yi: number; vm: ViewMode }> = [];
        sortedYears.forEach((y, yi) => {
          steps.push({ yi, vm: 'before' });
          if (mYears.includes(y)) steps.push({ yi, vm: 'after' });
        });
        const stepIdx = steps.findIndex(s => s.yi === targetYi && s.vm === targetVm);

        setPlayStepIndex(stepIdx >= 0 ? stepIdx : Math.max(0, steps.length - 1));
        setCurrentYearIndex(targetYi);
        setViewMode(targetVm);
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

  useEffect(() => {
    if (!highlightConfig) {
      setVisualListMode('suggested');
      return;
    }
    const nextMode = highlightConfig.mode || 'suggested';
    setVisualListMode(nextMode);
    if (highlightConfig.enableDisposalColors !== undefined) {
      setShowDisposalColors(highlightConfig.enableDisposalColors);
    }
    if (availableYears.length > 0 && highlightConfig.sourceYear && availableYears.includes(highlightConfig.sourceYear)) {
      jumpToYearMode(highlightConfig.sourceYear, nextMode === 'final' || nextMode === 'diff' ? 'after' : viewMode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightConfig]);

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
      renderTubeOnContext({
        c: ctx,
        tube,
        cx,
        cy,
        tubeRadius,
        isPrintMode,
        blinkVisible,
      });
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

  const renderTubeOnContext = ({
    c,
    tube,
    cx,
    cy,
    tubeRadius,
    isPrintMode,
    blinkVisible,
  }: {
    c: CanvasRenderingContext2D;
    tube: any;
    cx: number;
    cy: number;
    tubeRadius: number;
    isPrintMode: boolean;
    blinkVisible: boolean;
  }) => {
    const record = yearRecords[tube.id];
    const maintenance = maintenanceRecords[tube.id];
    const maintAction = normalizeMaintAction(maintenance?.action);
    let code = record?.code || '';

    let color = isPrintMode ? '#d1d5db' : '#334155';
    let isBlink = false;
    let isPlugged = false;
    let isOldPlug = false;
    let disposalColorApplied = false;

    const isHighlighted = activeHighlightSet ? activeHighlightSet.has(tube.id) : false;
    const inSug = suggestedTubeSet.has(tube.id);
    const inFin = finalTubeSet.has(tube.id);
    const diffRole: 'matched' | 'added' | 'kept' | 'none' =
      activeHighlightSet && visualListMode === 'diff'
        ? (inSug && inFin ? 'matched' : inFin ? 'added' : inSug ? 'kept' : 'none')
        : 'none';

    const mutedColor = (showGridMarkers && tube.col % 5 === 0)
      ? (isPrintMode ? '#3b82f6' : '#cbd5e1')
      : (isPrintMode ? '#e2e8f0' : '#1e293b');

    const isDNTTube = Boolean(record && (code === 'DNT' || (record.notes && record.notes.includes('DNT'))));

    // 差異對照模式：建議處置但最終評估保留 → 畫虛線空心圈
    if (diffRole === 'kept' && (!showDNTOnly || isDNTTube)) {
      c.save();
      c.fillStyle = isPrintMode ? 'rgba(100,116,139,0.16)' : 'rgba(148,163,184,0.18)';
      c.beginPath();
      c.arc(cx, cy, tubeRadius, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = isPrintMode ? '#475569' : '#94a3b8';
      c.lineWidth = Math.max(1.2, tubeRadius * 0.36);
      c.setLineDash([Math.max(2, tubeRadius * 0.55), Math.max(1.5, tubeRadius * 0.45)]);
      c.beginPath();
      c.arc(cx, cy, tubeRadius, 0, Math.PI * 2);
      c.stroke();
      c.restore();
      if (!isPrintMode && hoveredTube && hoveredTube.id === tube.id) {
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(cx, cy, tubeRadius + 2, 0, Math.PI * 2);
        c.stroke();
      }
      return;
    }

    if (record) {
      isPlugged = code === 'PLG';
      let depth = record.size_val || 0;

      if (viewMode === 'after') {
        if (maintenance) {
          if (maintAction === 'PLG') {
            isPlugged = true;
          } else if (maintAction === 'RPL') {
            isPlugged = false;
            depth = 0;
            code = 'NDD';
          }
        } else if (Object.keys(maintenanceRecords).length === 0) {
          if (depth > 50) isPlugged = true;
          if (code === 'COR') isPlugged = true;
        }
      }

      if (isPlugged) {
        color = isPrintMode ? '#cbd5e1' : '#64748b';
      } else if (code === 'OBS') {
        color = '#2563eb';
        isBlink = true;
      } else if (code === 'COR') {
        color = '#ff3fa4';
        isBlink = true;
      } else if (code === 'BLK' || code === 'RST') {
        color = isPrintMode ? '#94a3b8' : '#ffffff';
        isBlink = true;
      } else {
        if (depth <= 20) color = '#10b981';
        else if (depth <= 40) color = '#84cc16';
        else if (depth <= 60) color = '#eab308';
        else if (depth <= 80) color = '#f97316';
        else color = '#ef4444';
      }

      if (showDisposalColors && activeHighlightSet && isHighlighted) {
        if (maintAction === 'RPL') { color = '#ef4444'; isBlink = false; disposalColorApplied = true; }
        else if (maintAction === 'PLG') { color = '#e879f9'; isBlink = false; disposalColorApplied = true; }
      }

      if (activeHighlightSet && !isHighlighted) {
        color = mutedColor;
        isBlink = false;
        isPlugged = false;
      }
    } else if (registryRecords[tube.id]?.status === 'plugged') {
      const showOldPlugStyle = showDisposalColors && showOldPlugs;
      color = isPrintMode
        ? (showOldPlugStyle ? '#64748b' : '#cbd5e1')
        : (showOldPlugStyle ? '#64748b' : '#1e293b');
      if (showOldPlugStyle) isOldPlug = true;

      if (showDisposalColors && activeHighlightSet && isHighlighted) {
        if (maintAction === 'RPL') { color = '#ef4444'; isOldPlug = false; disposalColorApplied = true; }
        else if (maintAction === 'PLG') { color = '#e879f9'; isPlugged = true; isOldPlug = false; disposalColorApplied = true; }
      }

      if (activeHighlightSet && !isHighlighted) {
        color = mutedColor;
        isOldPlug = false;
      }
    } else {
      color = isPrintMode ? '#d1d5db' : '#334155';
      if (showDisposalColors && activeHighlightSet && isHighlighted) {
        if (maintAction === 'RPL') { color = '#ef4444'; disposalColorApplied = true; }
        else if (maintAction === 'PLG') { color = '#e879f9'; isPlugged = true; disposalColorApplied = true; }
      }
      if (activeHighlightSet && !isHighlighted) {
        color = mutedColor;
      }
    }

    if (showDNTOnly) {
      const allowedByHighlight = activeHighlightSet ? isHighlighted : true;
      if (isDNTTube && allowedByHighlight) {
        isBlink = !isPrintMode;
      } else {
        color = isPrintMode ? '#e2e8f0' : '#1e293b';
        isBlink = false;
        isOldPlug = false;
        isPlugged = false;
      }
    }

    if (!isPrintMode && isBlink && !blinkVisible) return;

    if (record && code === 'DNT' && !disposalColorApplied) {
      const isMuted = Boolean(
        (activeHighlightSet && !isHighlighted) ||
        (showDNTOnly && !(isDNTTube && (!activeHighlightSet || isHighlighted)))
      );

      if (isMuted) {
        c.fillStyle = mutedColor;
        c.beginPath();
        c.arc(cx, cy, tubeRadius, 0, Math.PI * 2);
        c.fill();
      } else {
        let innerColor = '#10b981';
        const depth = record.size_val || 0;
        if (depth <= 20) innerColor = '#10b981';
        else if (depth <= 40) innerColor = '#84cc16';
        else if (depth <= 60) innerColor = '#eab308';
        else if (depth <= 80) innerColor = '#f97316';
        else innerColor = '#ef4444';

        c.fillStyle = '#2563eb';
        c.beginPath();
        c.arc(cx, cy, tubeRadius, 0, Math.PI * 2);
        c.fill();

        c.fillStyle = innerColor;
        c.beginPath();
        c.arc(cx, cy, tubeRadius * 0.85, 0, Math.PI * 2);
        c.fill();
      }
    } else {
      c.fillStyle = color;
      c.beginPath();
      c.arc(cx, cy, tubeRadius, 0, Math.PI * 2);
      c.fill();
    }

    if ((isPlugged || isOldPlug) && color !== '#1e293b' && color !== '#e2e8f0') {
      const xSize = tubeRadius * 0.55;
      const xLW = Math.max(isPrintMode ? 0.8 : 1, tubeRadius * 0.35);
      c.save();
      c.strokeStyle = isPrintMode ? '#dc2626' : '#ef4444';
      c.lineWidth = xLW;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(cx - xSize, cy - xSize);
      c.lineTo(cx + xSize, cy + xSize);
      c.moveTo(cx + xSize, cy - xSize);
      c.lineTo(cx - xSize, cy + xSize);
      c.stroke();
      c.restore();
    }

    // 決策額外新增（非建議清單，但實際執行處置）：疊加醒目金色外框
    if (diffRole === 'added' && (!showDNTOnly || isDNTTube)) {
      c.save();
      c.strokeStyle = isPrintMode ? '#d97706' : '#facc15';
      c.lineWidth = Math.max(1.5, tubeRadius * 0.42);
      c.beginPath();
      c.arc(cx, cy, tubeRadius + Math.max(1.8, tubeRadius * 0.42), 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }

    if (!isPrintMode && hoveredTube && hoveredTube.id === tube.id) {
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cx, cy, tubeRadius + 2, 0, Math.PI * 2);
      c.stroke();
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
  }, [tubes, quadrantFilter, yearRecords, maintenanceRecords, registryRecords, hoveredTube, viewMode, activeHighlightSet, visualListMode, suggestedTubeSet, finalTubeSet, showGridMarkers, showDisposalColors, showOldPlugs, showDNTOnly]);


  const resolveCurrentUserPermission = async (candidateUser?: string) => {
    const info = await fetchCurrentUserPermission(candidateUser);
    setCurrentUserInfo(info);
  };

  useEffect(() => {
    resolveCurrentUserPermission();
    const handleUserChange = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      resolveCurrentUserPermission(detail?.userId || detail?.username);
    };
    window.addEventListener('unified-user-changed', handleUserChange);
    return () => {
      window.removeEventListener('unified-user-changed', handleUserChange);
      if (hoverHideTimerRef.current) window.clearTimeout(hoverHideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!editingTarget) return;
    const dlg = noteDialogRef.current;
    if (dlg && !dlg.open) {
      dlg.showModal();
    }
    const targetRef = editingTarget.activeMode === 'after' && editingTarget.hasAfter
      ? afterTextareaRef
      : beforeTextareaRef;
    targetRef.current?.focus();
  }, [editingTarget]);

  const openNoteEditor = (tube: any) => {
    if (!currentYear) return;
    setIsPlaying(false); // 編輯時暫停自動播放並鎖定年份與模式
    resolveCurrentUserPermission();
    const { systemDntTag, userNote } = splitSystemDntNote(yearRecords[tube.id]?.notes);
    const origCode = String(yearRecords[tube.id]?.code || 'NDD').trim().toUpperCase();
    const origDepth = Number(yearRecords[tube.id]?.size_val) || 0;
    setEditCode(origCode);
    setEditDepth(String(origDepth));
    setEditBeforeNote(userNote);
    setEditAfterNote(maintenanceRecords[tube.id]?.notes || '');
    setConfirmingValueChange(false);
    setNoteSaveError('');
    setEditingTarget({
      tube,
      year: currentYear,
      hasAfter: hasAfterData,
      activeMode: viewMode,
      systemDntTag,
      origCode,
      origDepth,
    });
  };

  const handleSaveTubeNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTarget) return;

    const { tube, year, hasAfter, systemDntTag, origCode, origDepth } = editingTarget;
    const finalBefore = buildCombinedBeforeNote(systemDntTag, editBeforeNote);
    const finalAfter = editAfterNote.trim();
    const normalizedCode = editCode.trim().toUpperCase();
    const parsedDepth = parseFloat(editDepth);

    const isValueModified =
      normalizedCode !== origCode ||
      Math.abs((Number.isNaN(parsedDepth) ? -1 : parsedDepth) - origDepth) > 0.001;

    if (isValueModified) {
      if (Number.isNaN(parsedDepth) || parsedDepth < 0 || parsedDepth > 100) {
        setNoteSaveError('瑕疵深度必須為 0 ~ 100 之間的數字');
        setConfirmingValueChange(false);
        return;
      }
      if (!currentUserInfo.isAdmin) {
        setNoteSaveError('權限不足：僅 Condensor 專案管理人員可修改瑕疵碼與深度');
        setConfirmingValueChange(false);
        return;
      }
      if (!confirmingValueChange) {
        setNoteSaveError('');
        setConfirmingValueChange(true);
        return;
      }
    }

    setNoteSaving(true);
    setNoteSaveError('');

    try {
      const payload: Record<string, any> = {
        unit_id: unitId,
        year,
        zone: tube.zone,
        row_num: tube.row,
        col_num: tube.col,
        before_notes: finalBefore,
      };
      if (isValueModified) {
        payload.code = normalizedCode;
        payload.size_val = parsedDepth;
        payload.operator = currentUserInfo.userId || currentUserInfo.userName;
        payload.confirm_inspection_change = true;
      }
      if (hasAfter) {
        payload.after_notes = finalAfter;
      }

      const res = await fetch(`${import.meta.env.BASE_URL}api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || '儲存失敗');
      }

      const persistedCode = result.code ?? origCode;
      const persistedDepth = result.size_val ?? origDepth;
      const persistedBeforeNote = result.before_notes !== undefined ? result.before_notes : finalBefore;

      setYearRecords(prev => {
        const next = { ...prev };
        const existing = next[tube.id];
        if (existing) {
          next[tube.id] = {
            ...existing,
            code: persistedCode,
            size_val: persistedDepth,
            notes: persistedBeforeNote || null,
          };
        } else if (persistedBeforeNote || isValueModified) {
          next[tube.id] = {
            unit_id: unitId,
            year,
            zone: tube.zone,
            row_num: tube.row,
            col_num: tube.col,
            code: persistedCode,
            size_val: persistedDepth,
            notes: persistedBeforeNote || null,
          };
        }
        return next;
      });

      if (hasAfter) {
        setMaintenanceRecords(prev => {
          const next = { ...prev };
          const existing = next[tube.id];
          if (existing) {
            next[tube.id] = { ...existing, notes: finalAfter || null };
          } else if (finalAfter) {
            next[tube.id] = {
              unit_id: unitId,
              year,
              zone: tube.zone,
              row_num: tube.row,
              col_num: tube.col,
              action: 'KEP',
              notes: finalAfter,
            };
          }
          return next;
        });
      }

      noteDialogRef.current?.close();
    } catch (err: any) {
      setNoteSaveError(err.message || '儲存失敗，請稍後再試');
    } finally {
      setNoteSaving(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (hoverHideTimerRef.current) {
      window.clearTimeout(hoverHideTimerRef.current);
      hoverHideTimerRef.current = null;
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

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
    let closestCx = 0;
    let closestCy = 0;
    let minDist = Infinity;

    filteredTubes.forEach(tube => {
      const cx = offsetX + tube.x * scale;
      const cy = offsetY + tube.y * scale;
      const dist = Math.sqrt(Math.pow(cx - x, 2) + Math.pow(cy - y, 2));
      
      if (dist < scale && dist < minDist) {
        minDist = dist;
        closest = tube;
        closestCx = cx;
        closestCy = cy;
      }
    });

    if (closest) {
      setMousePos({ x: rect.left + closestCx, y: rect.top + closestCy });
      setHoveredTube(closest);
    } else if (!isTooltipHoveredRef.current) {
      setHoveredTube(null);
    }
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
        body: JSON.stringify({
          records,
          password: pass,
          unit_id: unitId,
          year: currentYear,
          notes_mode: uploadNotesMode,
        })
      });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 403 && result.requirePassword) {
          setUploadExistingNotesCount(result.existingNotesCount || 0);
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
      setUploadExistingNotesCount(0);
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
    const filterMode = activeHighlightSet ? visualListMode : 'full';
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
        renderTubeOnContext({
          c: oc,
          tube,
          cx,
          cy,
          tubeRadius: tr,
          isPrintMode: true,
          blinkVisible: true,
        });
      });

      // title
      oc.save(); oc.fillStyle='#0f172a'; oc.font='bold 26px sans-serif';
      oc.textAlign='left'; oc.textBaseline='top'; oc.fillText(label,18,14); oc.restore();

      // LEGEND（處置顏色 ON 或差異對照模式時繪製）
      if (showDisposalColors || (activeHighlightSet && visualListMode === 'diff')) {
        type LegendItem = { color: string; label: string; isOldPlug?: boolean; isAddedRing?: boolean; isKeptDash?: boolean };
        const legendItems: LegendItem[] = [
          ...(showDisposalColors ? [
            { color: '#ef4444', label: '換管' },
            { color: '#e879f9', label: '塞管' },
          ] : []),
          ...(showDisposalColors && showOldPlugs ? [{ color: '#64748b', label: '舊塞管', isOldPlug: true }] : []),
          ...(activeHighlightSet && visualListMode === 'diff' ? [
            { color: '#facc15', label: '額外新增', isAddedRing: true },
            { color: '#94a3b8', label: '建議保留', isKeptDash: true },
          ] : []),
        ];
        if (legendItems.length > 0) {
          const dotR = 7;
          const itemW = 92;
          const legendW = legendItems.length * itemW + 16;
          const legendH = 32;
          const lx = W - legendW - 12;
          const ly = H - legendH - 12;

          // 背景
          oc.save();
          oc.fillStyle = 'rgba(15,23,42,0.82)';
          oc.beginPath();
          (oc as any).roundRect?.(lx, ly, legendW, legendH, 6) || oc.rect(lx, ly, legendW, legendH);
          oc.fill();

          // 項目
          oc.font = 'bold 12px sans-serif';
          oc.textBaseline = 'middle';
          legendItems.forEach((item, i) => {
            const ix = lx + 14 + i * itemW;
            const iy = ly + legendH / 2;
            if (item.isKeptDash) {
              oc.save();
              oc.strokeStyle = '#cbd5e1';
              oc.lineWidth = 1.8;
              oc.setLineDash([3, 2]);
              oc.beginPath();
              oc.arc(ix, iy, dotR, 0, Math.PI * 2);
              oc.stroke();
              oc.restore();
            } else if (item.isAddedRing) {
              oc.fillStyle = '#e879f9';
              oc.beginPath();
              oc.arc(ix, iy, dotR - 1.5, 0, Math.PI * 2);
              oc.fill();
              oc.strokeStyle = '#facc15';
              oc.lineWidth = 2;
              oc.beginPath();
              oc.arc(ix, iy, dotR + 1.5, 0, Math.PI * 2);
              oc.stroke();
            } else {
              oc.fillStyle = item.color;
              oc.beginPath();
              oc.arc(ix, iy, dotR, 0, Math.PI * 2);
              oc.fill();
              if (item.isOldPlug) {
                const xs = dotR * 0.6; const xlw = Math.max(0.8, dotR * 0.35);
                oc.strokeStyle = '#dc2626'; oc.lineWidth = xlw; oc.lineCap = 'round';
                oc.beginPath(); oc.moveTo(ix-xs,iy-xs); oc.lineTo(ix+xs,iy+xs);
                oc.moveTo(ix+xs,iy-xs); oc.lineTo(ix-xs,iy+xs); oc.stroke();
              }
            }
            oc.fillStyle = '#f8fafc';
            oc.textAlign = 'left';
            oc.fillText(item.label, ix + dotR + 6, iy);
          });
          oc.restore();
        }
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
      {activeHighlightSet && (
        <div className="bg-indigo-900/40 border border-indigo-700 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-y-2 shadow-lg mb-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xl">🔍</span>
            {suggestedTubeSet.size > 0 && (hasAfterData || finalTubeSet.size > 0) ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-indigo-200 font-medium text-sm">檢視來源：</span>
                <div className="inline-flex rounded-lg border border-indigo-700/70 bg-slate-950/70 p-0.5">
                  <button
                    type="button"
                    onClick={() => setVisualListMode('suggested')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                      visualListMode === 'suggested'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    建議處置 ({suggestedTubeSet.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVisualListMode('final');
                      setShowDisposalColors(true);
                      if (hasAfterData && viewMode !== 'after') setViewMode('after');
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                      visualListMode === 'final'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    最終處置 After ({finalTubeSet.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVisualListMode('diff');
                      setShowDisposalColors(true);
                      if (hasAfterData && viewMode !== 'after') setViewMode('after');
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                      visualListMode === 'diff'
                        ? 'bg-amber-600 text-white shadow'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    建議 vs 最終差異
                  </button>
                </div>
                {visualListMode === 'diff' && (
                  <span className="text-xs text-slate-300 font-mono bg-slate-900/80 border border-slate-700 px-2.5 py-1 rounded">
                    依建議 {diffBreakdown.matched} · 新增 +{diffBreakdown.added} · 保留 -{diffBreakdown.kept}
                  </span>
                )}
                {visualListMode === 'final' && (
                  <span className="text-xs text-emerald-300 font-mono bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1 rounded">
                    換管 {finalActionCounts.rpl} · 塞管 {finalActionCounts.plg}
                  </span>
                )}
              </div>
            ) : visualListMode === 'final' ? (
              <span className="text-emerald-200 font-medium tracking-wide">
                正在檢視最終大修處置 (After)
                <span className="font-bold text-white bg-emerald-800 px-2 py-0.5 rounded ml-2">共 {activeHighlightSet.size} 支</span>
                {(finalActionCounts.rpl > 0 || finalActionCounts.plg > 0) && (
                  <span className="text-xs text-emerald-300 ml-2 font-mono">
                    (換管 {finalActionCounts.rpl} · 塞管 {finalActionCounts.plg})
                  </span>
                )}
              </span>
            ) : (
              <span className="text-indigo-200 font-medium tracking-wide">
                正在檢視篩選清單的重點管束 <span className="font-bold text-white bg-indigo-800 px-2 py-0.5 rounded ml-1">共 {activeHighlightSet.size} 支</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 情境 A/B 二選一 */}
            {currentYear && !maintenanceYears.includes(currentYear) ? (
              <button
                onClick={() => { setShowUploadModal(true); setUploadStatus('idle'); setUploadMessage(''); setPendingUploadRecords([]); setUploadExistingNotesCount(0); }}
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
                {(showDisposalColors || visualListMode === 'diff') && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 bg-slate-800/60 px-3 py-1.5 rounded-md border border-slate-700">
                    {showDisposalColors && (
                      <>
                        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-red-500"/>換管</span>
                        <span className="inline-flex items-center gap-1 ml-1"><span className="inline-block w-3 h-3 rounded-full bg-fuchsia-400"/>塞管</span>
                      </>
                    )}
                    {showDisposalColors && showOldPlugs && (
                      <span className="inline-flex items-center gap-1 ml-1">
                        <span className="relative inline-flex items-center justify-center w-3 h-3">
                          <span className="absolute inset-0 rounded-full bg-slate-500"/>
                          <span className="relative text-red-500 font-black" style={{fontSize:'8px',lineHeight:1}}>✕</span>
                        </span>
                        舊塞管
                      </span>
                    )}
                    {visualListMode === 'diff' && (
                      <>
                        <span className="inline-flex items-center gap-1 ml-1">
                          <span className="inline-block w-3 h-3 rounded-full border-2 border-yellow-400 bg-fuchsia-400/80"/>
                          額外新增
                        </span>
                        <span className="inline-flex items-center gap-1 ml-1">
                          <span className="inline-block w-3 h-3 rounded-full border border-dashed border-slate-400 bg-slate-400/20"/>
                          建議保留
                        </span>
                      </>
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
              <div className="space-y-3 mb-3">
                {uploadExistingNotesCount > 0 && (
                  <fieldset className="bg-amber-950/30 border border-amber-600/40 rounded-lg p-3 space-y-2">
                    <legend className="text-xs font-semibold text-amber-300 px-1">
                      備註覆蓋檢查（目前共有 {uploadExistingNotesCount} 筆非空白處置備註）
                    </legend>
                    <div className="flex items-start gap-2">
                      <input
                        id="quick-upload-notes-merge"
                        name="quickUploadNotesMode"
                        type="radio"
                        checked={uploadNotesMode === 'merge'}
                        onChange={() => setUploadNotesMode('merge')}
                        className="mt-1 accent-blue-500"
                      />
                      <label htmlFor="quick-upload-notes-merge" className="text-xs text-slate-200 cursor-pointer">
                        合併保留既有備註（保留手動備註與僅含備註的保留管）
                      </label>
                    </div>
                    <div className="flex items-start gap-2">
                      <input
                        id="quick-upload-notes-overwrite"
                        name="quickUploadNotesMode"
                        type="radio"
                        checked={uploadNotesMode === 'overwrite'}
                        onChange={() => setUploadNotesMode('overwrite')}
                        className="mt-1 accent-red-500"
                      />
                      <label htmlFor="quick-upload-notes-overwrite" className="text-xs text-slate-300 cursor-pointer">
                        完全覆蓋（以新上傳檔案為準）
                      </label>
                    </div>
                  </fieldset>
                )}
                <div className="flex items-center gap-2">
                  <Lock size={14} className="text-yellow-400"/>
                  <input
                    type="password" placeholder="覆寫密碼" value={uploadPassword}
                    onChange={e => setUploadPassword(e.target.value)}
                    className="flex-1 bg-slate-800 border border-yellow-600 rounded-md px-3 py-1.5 text-sm text-white"
                  />
                </div>
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
            <button 
              onClick={() => setShowDNTOnly(prev => !prev)}
              className={`flex items-center gap-1.5 px-2 py-1 -ml-2 rounded transition-colors ${
                showDNTOnly ? 'bg-blue-600/30 ring-1 ring-blue-500' : 'hover:bg-slate-800'
              }`}
              title="點擊僅顯示並閃爍 DNT 及包含 DNT 備註之管束"
            >
              <div className="w-3 h-3 rounded-full bg-blue-600 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              </div>
              <span className={`ml-1 ${showDNTOnly ? 'text-blue-300 font-bold' : 'text-slate-300'}`}>DNT 管凹陷</span>
            </button>
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
              {/* 底線：若有未來預期點則向右延伸 */}
              <div className={`absolute left-0 h-1 bg-slate-800 rounded-full top-[8px] z-0 ${
                filterSourceYear && !maintenanceYears.includes(filterSourceYear) ? 'right-0' : 'right-0'
              }`}></div>

              {playSteps.map((step, si) => {
                const year = availableYears[step.yi];
                const isActive = si === playStepIndex;
                const isPast = si < playStepIndex;
                const isBefore = step.vm === 'before';

                // ── 情境 B：時間軸上已存在該年份 → 在對應步驟的圓點加閃爍外圈
                // 本次比對年份(amber) 與 基準比對年份(violet) 分別標記
                const isSourceTarget =
                  filterSourceYear != null &&
                  activeHighlightSet != null &&
                  activeHighlightSet.size > 0 &&
                  year === filterSourceYear &&
                  availableYears.includes(filterSourceYear);

                const isBaseTarget =
                  filterBaseYear != null &&
                  activeHighlightSet != null &&
                  activeHighlightSet.size > 0 &&
                  year === filterBaseYear &&
                  availableYears.includes(filterBaseYear);

                const isFilterTarget = isSourceTarget || isBaseTarget;

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
                    {/* 情境 B：閃爍漣漪外圈（本次比對 amber，基準比對 violet） */}
                    {isSourceTarget && (
                      <>
                        <div className="absolute w-7 h-7 rounded-full bg-amber-400/40 animate-ping top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0" />
                        <div className="absolute w-6 h-6 rounded-full border-2 border-amber-400 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0 opacity-80" />
                      </>
                    )}
                    {isBaseTarget && (
                      <>
                        <div className="absolute w-7 h-7 rounded-full bg-violet-400/40 animate-ping top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0" />
                        <div className="absolute w-6 h-6 rounded-full border-2 border-violet-400 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0 opacity-80" />
                      </>
                    )}
                    {/* 節點圓點：before=藍，after=綠 */}
                    <div className={`relative z-10 w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                      isActive
                        ? (isBefore ? 'bg-blue-500 border-blue-400 scale-125 shadow-[0_0_8px_rgba(59,130,246,0.7)]' : 'bg-emerald-500 border-emerald-400 scale-125 shadow-[0_0_8px_rgba(16,185,129,0.7)]')
                        : isPast
                          ? (isBefore ? 'bg-blue-900 border-blue-700' : 'bg-emerald-900 border-emerald-700')
                          : 'bg-slate-800 border-slate-600 group-hover:border-blue-500'
                    } ${
                      isSourceTarget ? 'shadow-[0_0_10px_rgba(251,191,36,0.8)]' :
                      isBaseTarget  ? 'shadow-[0_0_10px_rgba(167,139,250,0.8)]' : ''
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

              {/* ── 情境 A：時間軸上不存在的年份 → 末端顯示預期閃爍點 */}
              {(() => {
                if (!activeHighlightSet || activeHighlightSet.size === 0) return null;
                // 收集兩個比較年份中，時間軸上不存在的年份
                const futureYears: Array<{ year: number; isSource: boolean }> = [];
                if (filterSourceYear != null && !availableYears.includes(filterSourceYear)) {
                  futureYears.push({ year: filterSourceYear, isSource: true });
                }
                if (filterBaseYear != null && !availableYears.includes(filterBaseYear) &&
                    filterBaseYear !== filterSourceYear) {
                  futureYears.push({ year: filterBaseYear, isSource: false });
                }
                if (futureYears.length === 0) return null;
                return futureYears.map(({ year, isSource }) => (
                  <div key={`future-${year}`} className="relative z-10 flex flex-col items-center ml-6">
                    <div className="relative w-5 h-5 flex items-center justify-center">
                      <div className={`absolute inset-0 rounded-full animate-ping opacity-60 ${
                        isSource ? 'bg-amber-400' : 'bg-violet-400'
                      }`} />
                      <div className={`absolute inset-0 rounded-full animate-ping opacity-40 ${
                        isSource ? 'bg-amber-500/30' : 'bg-violet-500/30'
                      }`} style={{ animationDelay: '0.25s' }} />
                      <div className={`relative w-4 h-4 rounded-full border-2 border-dashed z-10 ${
                        isSource
                          ? 'bg-amber-500 border-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.9)]'
                          : 'bg-violet-500 border-violet-300 shadow-[0_0_12px_rgba(167,139,250,0.9)]'
                      }`} />
                    </div>
                    <div className="absolute top-7 flex flex-col items-center gap-0.5 pointer-events-none">
                      <span className={`text-xs font-bold whitespace-nowrap ${
                        isSource ? 'text-amber-300' : 'text-violet-300'
                      }`}>{year}</span>
                      <span className={`text-[10px] whitespace-nowrap px-1.5 py-0.5 rounded-full border ${
                        isSource
                          ? 'text-amber-400/90 bg-amber-900/30 border-amber-700/40'
                          : 'text-violet-400/90 bg-violet-900/30 border-violet-700/40'
                      }`}>
                        {isSource ? '預期大修檢測' : '預期基準年份'}
                      </span>
                    </div>
                  </div>
                ));
              })()}

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
            onClick={() => {
              if (hoveredTube && currentYear) {
                openNoteEditor(hoveredTube);
              }
            }}
            onMouseLeave={() => {
              if (hoverHideTimerRef.current) window.clearTimeout(hoverHideTimerRef.current);
              hoverHideTimerRef.current = window.setTimeout(() => {
                if (!isTooltipHoveredRef.current) {
                  setHoveredTube(null);
                }
              }, 150);
            }}
          />
          
          {isRendering && (
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm z-10 flex flex-col items-center justify-center transition-opacity duration-300">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
              <span className="text-blue-400 font-medium text-lg tracking-wider">切換視圖中...</span>
            </div>
          )}

          {hoveredTube && (
            <div 
              className="fixed z-50 bg-slate-800 border border-slate-700 text-slate-200 p-4 rounded-lg shadow-xl text-sm pointer-events-auto transform -translate-x-1/2 -translate-y-full mt-[-8px] min-w-[290px] max-w-[360px]"
              style={{ left: mousePos.x, top: mousePos.y }}
              onMouseEnter={() => {
                isTooltipHoveredRef.current = true;
                if (hoverHideTimerRef.current) {
                  window.clearTimeout(hoverHideTimerRef.current);
                  hoverHideTimerRef.current = null;
                }
              }}
              onMouseLeave={() => {
                isTooltipHoveredRef.current = false;
                setHoveredTube(null);
              }}
            >
              <div className="font-bold text-base mb-2 border-b border-slate-700 pb-1 text-white flex justify-between">
                <span>位置: {hoveredTube.zone} / 行 {hoveredTube.row} / 列 {hoveredTube.col}</span>
                <span className="text-xs px-2 py-0.5 bg-slate-700 rounded-full text-slate-300">{unitId}</span>
              </div>

              {activeHighlightSet && (() => {
                const inSug = suggestedTubeSet.has(hoveredTube.id);
                const inFin = finalTubeSet.has(hoveredTube.id);
                if (!inSug && !inFin) return null;
                let badgeLabel = '📋 建議處置管束';
                let badgeClass = 'bg-indigo-950/70 border-indigo-700/60 text-indigo-200';
                if (visualListMode === 'diff' || (inSug && hasAfterData)) {
                  if (inSug && inFin) {
                    badgeLabel = '✅ 依建議執行最終處置';
                    badgeClass = 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300';
                  } else if (inFin) {
                    badgeLabel = '➕ 決策額外新增處置（未達建議公式）';
                    badgeClass = 'bg-amber-950/70 border-amber-600/60 text-amber-300';
                  } else if (inSug && hasAfterData) {
                    badgeLabel = '➖ 建議處置但最終評估保留';
                    badgeClass = 'bg-slate-900 border-slate-600 text-slate-300';
                  }
                } else if (inFin) {
                  badgeLabel = '🛠️ 最終大修處置 (After)';
                  badgeClass = 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300';
                }
                return (
                  <div className={`mb-2 px-2.5 py-1 rounded border text-xs font-semibold ${badgeClass}`}>
                    {badgeLabel}
                  </div>
                );
              })()}
              
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
              
              <div className="pt-1 space-y-2">
                <div className="font-semibold text-blue-400 leading-none">檢測結果 ({currentYear || '無'})</div>
                {yearRecords[hoveredTube.id] ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm bg-slate-900/50 p-2 rounded">
                    <span className="text-slate-400">瑕疵碼:</span>
                    <span className="font-mono text-blue-300">{yearRecords[hoveredTube.id].code}</span>
                    <span className="text-slate-400">深度 (%):</span>
                    <span className="font-bold">{yearRecords[hoveredTube.id].size_val?.toFixed(1) || '0.0'}</span>
                    
                    <span className="text-slate-400 mt-1">檢測備註 (Before):</span>
                    <span className={`text-xs mt-1 self-center leading-tight break-words ${yearRecords[hoveredTube.id].notes ? 'text-amber-400' : 'text-slate-500'}`}>
                      {yearRecords[hoveredTube.id].notes || '無'}
                    </span>
                    
                    {(viewMode === 'after' || hasAfterData) && (
                      <>
                        <span className="text-slate-400 mt-1">實際處置:</span>
                        <span className={`font-mono mt-1 font-bold ${
                          isDisposalAction(maintenanceRecords[hoveredTube.id]?.action)
                            ? 'text-emerald-400'
                            : 'text-slate-400'
                        }`}>
                          {!maintenanceRecords[hoveredTube.id]?.action
                            ? '無特別處置'
                            : normalizeMaintAction(maintenanceRecords[hoveredTube.id]?.action) === 'KEP'
                              ? '無特別處置 (保留)'
                              : formatMaintActionLabel(maintenanceRecords[hoveredTube.id]?.action)}
                        </span>
                        <span className="text-slate-400 mt-1">處置備註 (After):</span>
                        <span className={`text-xs mt-1 self-center leading-tight break-words ${maintenanceRecords[hoveredTube.id]?.notes ? 'text-emerald-300' : 'text-slate-500'}`}>
                          {maintenanceRecords[hoveredTube.id]?.notes || '無'}
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
                  <div className="text-slate-500 italic p-2 text-xs bg-slate-900/50 rounded">此年份無檢測紀錄</div>
                )}

                {currentYear && (
                  <div className="pt-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">可點擊管束或按鈕編輯</span>
                    <button
                      type="button"
                      onClick={() => openNoteEditor(hoveredTube)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                    >
                      <Pencil size={12} aria-hidden="true" />
                      編輯備註
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 單支管備註與複檢編輯 Modal (<dialog>) */}
      <dialog
        ref={noteDialogRef}
        aria-labelledby="note-dialog-title"
        onClose={() => {
          setEditingTarget(null);
          setConfirmingValueChange(false);
          setNoteSaveError('');
        }}
        className="m-auto w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 text-slate-200 p-0 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        {editingTarget && (() => {
          const parsedDepth = parseFloat(editDepth);
          const isValueModified =
            editCode.trim().toUpperCase() !== editingTarget.origCode ||
            Math.abs((Number.isNaN(parsedDepth) ? -1 : parsedDepth) - editingTarget.origDepth) > 0.001;
          const hasCustomCode = !INSPECTION_CODE_OPTIONS.some(opt => opt.code === editCode);

          return (
            <form onSubmit={handleSaveTubeNote} className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 id="note-dialog-title" className="text-lg font-bold text-white flex items-center gap-2">
                    <Pencil size={18} className="text-blue-400" aria-hidden="true" />
                    編輯管束資料與備註
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    {unitId} / {editingTarget.tube.zone} 區 / 行 {editingTarget.tube.row} / 列 {editingTarget.tube.col} — {editingTarget.year} 年
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => noteDialogRef.current?.close()}
                  aria-label="關閉視窗"
                  className="p-1 text-slate-400 hover:text-white rounded"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs border ${
                currentUserInfo.isAdmin
                  ? 'bg-emerald-950/30 border-emerald-700/50 text-emerald-300'
                  : 'bg-slate-950/60 border-slate-800 text-slate-400'
              }`}>
                <ShieldCheck size={15} className={currentUserInfo.isAdmin ? 'text-emerald-400 shrink-0' : 'text-slate-500 shrink-0'} aria-hidden="true" />
                <span>
                  {currentUserInfo.isAdmin
                    ? `管理人員已授權：${currentUserInfo.userName} (${currentUserInfo.userId}) — 可修改瑕疵碼、深度與備註`
                    : `目前登入：${currentUserInfo.userName} — 僅編輯備註（改瑕疵碼/深度需管理人員授權）`}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-950/50 border border-slate-800 rounded-lg p-3">
                <div className="space-y-1">
                  <label htmlFor="edit-tube-code" className="block text-xs font-medium text-slate-300">
                    瑕疵碼 (Code)
                  </label>
                  <select
                    id="edit-tube-code"
                    name="inspectionCode"
                    value={editCode}
                    disabled={!currentUserInfo.isAdmin}
                    onChange={(e) => {
                      setEditCode(e.target.value);
                      setConfirmingValueChange(false);
                      setNoteSaveError('');
                    }}
                    className="w-full bg-slate-900 border border-slate-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg px-2.5 py-2 text-xs text-blue-300 font-mono focus:outline-none focus:border-blue-500"
                  >
                    {hasCustomCode && <option value={editCode}>{editCode}</option>}
                    {INSPECTION_CODE_OPTIONS.map(opt => (
                      <option key={opt.code} value={opt.code}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="edit-tube-depth" className="block text-xs font-medium text-slate-300">
                    瑕疵深度 (%)
                  </label>
                  <input
                    id="edit-tube-depth"
                    name="inspectionDepth"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={editDepth}
                    disabled={!currentUserInfo.isAdmin}
                    onChange={(e) => {
                      setEditDepth(e.target.value);
                      setConfirmingValueChange(false);
                      setNoteSaveError('');
                    }}
                    className="w-full bg-slate-900 border border-slate-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg px-2.5 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {editingTarget.systemDntTag && (
                <div className="bg-blue-950/40 border border-blue-700/50 rounded-lg px-3 py-2 text-xs text-blue-300">
                  系統自動標記（固定保留）：<span className="font-mono font-semibold">{editingTarget.systemDntTag}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="edit-before-note" className="block text-sm font-medium text-blue-300">
                  檢測結果 (Before) 備註
                </label>
                <textarea
                  ref={beforeTextareaRef}
                  id="edit-before-note"
                  name="beforeNote"
                  rows={3}
                  value={editBeforeNote}
                  onChange={(e) => setEditBeforeNote(e.target.value)}
                  placeholder="輸入該年份檢測階段的備註（留空即清除）"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {editingTarget.hasAfter ? (
                <div className="space-y-1.5">
                  <label htmlFor="edit-after-note" className="block text-sm font-medium text-emerald-300">
                    大修處置後 (After) 備註
                  </label>
                  <textarea
                    ref={afterTextareaRef}
                    id="edit-after-note"
                    name="afterNote"
                    rows={3}
                    value={editAfterNote}
                    onChange={(e) => setEditAfterNote(e.target.value)}
                    placeholder="輸入該年份大修處置後的備註（留空即清除）"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-500 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
                  {editingTarget.year} 年尚無大修處置紀錄，目前僅開放編輯檢測結果 (Before) 備註。
                </p>
              )}

              {confirmingValueChange && isValueModified && (
                <div role="status" className="bg-amber-950/40 border border-amber-500/60 rounded-xl p-3.5 space-y-1.5 text-xs">
                  <div className="font-bold text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
                    變更內容確認（將影響處置篩選與塞管統計）
                  </div>
                  <div className="text-slate-300">
                    管束位置：<span className="font-mono text-white">{unitId} / {editingTarget.tube.zone}-{editingTarget.tube.row}-{editingTarget.tube.col} ({editingTarget.year} 年)</span>
                  </div>
                  <div className="text-slate-300">
                    瑕疵碼：<span className="font-mono text-slate-400">{editingTarget.origCode}</span> ➔ <span className="font-mono font-bold text-amber-300">{editCode}</span>
                  </div>
                  <div className="text-slate-300">
                    瑕疵深度：<span className="font-mono text-slate-400">{editingTarget.origDepth.toFixed(1)}%</span> ➔ <span className="font-mono font-bold text-amber-300">{Number.isNaN(parsedDepth) ? '-' : `${parsedDepth.toFixed(1)}%`}</span>
                  </div>
                  <div className="text-amber-200/80 pt-1">
                    系統將自動附加複檢修正留痕至檢測備註，請確認無誤後再送出。
                  </div>
                </div>
              )}

              {noteSaveError && (
                <p role="alert" className="text-xs text-red-400 bg-red-950/30 border border-red-800/50 rounded-lg px-3 py-2">
                  {noteSaveError}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
                {confirmingValueChange && isValueModified ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirmingValueChange(false)}
                      className="px-4 py-2 text-sm text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                    >
                      返回修改
                    </button>
                    <button
                      type="submit"
                      disabled={noteSaving}
                      className="px-5 py-2 text-sm bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
                    >
                      {noteSaving ? '變更中...' : '同意並確認變更'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => noteDialogRef.current?.close()}
                      className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={noteSaving}
                      className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
                    >
                      {noteSaving ? '儲存中...' : isValueModified ? '檢視變更確認' : '儲存備註'}
                    </button>
                  </>
                )}
              </div>
            </form>
          );
        })()}
      </dialog>
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
