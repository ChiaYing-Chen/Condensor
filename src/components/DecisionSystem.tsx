import React, { useState, useEffect, useRef } from 'react';
import { Settings2, ShieldAlert, Wrench, AlertTriangle, Database, Plus, Trash2, Loader2, Play, Download, Save, Bookmark, GitCompare, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { VisualHighlightRequest, DecisionLaunchRequest } from '../types';
import { normalizeMaintAction, formatMaintActionLabel } from '../utils/maintenanceAction';

interface DecisionSystemProps {
  unitData: any;
  onApplyToVisual?: (request: VisualHighlightRequest) => void;
  launchRequest?: DecisionLaunchRequest | null;
}

interface Rule {
  id: string;
  formula: string;
  enabled: boolean;
}

const compileRuleFormula = (formula: string) => {
  let safeFormula = formula.replace(/%/g, '');
  safeFormula = safeFormula.replace(/\+(\d+)/g, '$1');
  // Replace single '=' with '===' if not part of >=, <=, !=, ==
  safeFormula = safeFormula.replace(/(?<![=<>!])=(?![=])/g, '===');
  // Replace 'and' with '&&', 'or' with '||'
  safeFormula = safeFormula.replace(/\band\b/gi, '&&').replace(/\bor\b/gi, '||');
  return safeFormula;
};

const evaluateRule = (formula: string, context: any) => {
  if (!formula.trim()) return false;
  try {
    const safeFormula = compileRuleFormula(formula);
    const keys = Object.keys(context);
    const values = Object.values(context);
    const func = new Function(...keys, `return ${safeFormula};`);
    return func(...values);
  } catch (e) {
    return false;
  }
};

const isFormulaSyntaxValid = (formula: string) => {
  if (!formula.trim()) return false;
  try {
    const safeFormula = compileRuleFormula(formula);
    new Function('TubeAge', 'depth_Diff', 'this_depth', 'previous_depth', 'Code', `return ${safeFormula};`);
    return true;
  } catch {
    return false;
  }
};

const DEFAULT_RULES: Rule[] = [
  { id: '1', formula: 'depth_Diff > 30 and this_depth >= 40', enabled: true },
  { id: '2', formula: 'depth_Diff > 35', enabled: true },
  { id: '3', formula: 'this_depth > 50', enabled: true },
  { id: '4', formula: 'Code = "COR"', enabled: true },
];

const DEFAULT_WARNING_FORMULA = 'this_depth >= 40';

const CODE_DEFINITIONS = [
  { code: 'NDD', label: '無缺陷' },
  { code: 'COR', label: '外部氨腐蝕' },
  { code: 'DNT', label: '管凹陷' },
  { code: 'PIT', label: '內部孔蝕' },
  { code: 'PLG', label: '塞管' },
  { code: 'BLK', label: '堵管' },
  { code: 'RST', label: '渦電流探頭無法通過(無法檢測)' },
] as const;

const CODE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  CODE_DEFINITIONS.map(({ code, label }) => [code, label])
);

const VARIABLE_LABEL_MAP: Record<string, string> = {
  TubeAge: '管齡(年)',
  depth_Diff: '深度差異(%)',
  this_depth: '當前深度(%)',
  previous_depth: '前次深度(%)',
  Code: '種類',
};

const formatReasonForExcel = (reason: string): string => {
  let formatted = reason;

  // Replace quoted defect codes (e.g. "COR" or 'COR') with their Chinese descriptions
  formatted = formatted.replace(
    /(['"])(NDD|COR|DNT|PIT|PLG|BLK|RST)\1/g,
    (_match, _quote, code) => `"${CODE_LABEL_MAP[code] || code}"`
  );

  // Replace formula variable names with Chinese labels
  Object.entries(VARIABLE_LABEL_MAP).forEach(([varName, label]) => {
    formatted = formatted.replace(new RegExp(`\\b${varName}\\b`, 'g'), label);
  });

  // Replace logical operators for readability
  formatted = formatted
    .replace(/\band\b|&&/gi, '且')
    .replace(/\bor\b|\|\|/gi, '或')
    .replace(/={2,3}/g, '=');

  return formatted;
};

export default function DecisionSystem({ unitData, onApplyToVisual, launchRequest }: DecisionSystemProps) {
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [maintenanceYears, setMaintenanceYears] = useState<number[]>([]);
  const [currentSelection, setCurrentSelection] = useState<string>('');
  const [previousSelection, setPreviousSelection] = useState<string>('');
  
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  const [warningFormula, setWarningFormula] = useState<string>(DEFAULT_WARNING_FORMULA);
  const [warningFormulaError, setWarningFormulaError] = useState<string>('');
  const [savedProfiles, setSavedProfiles] = useState<{name: string, rules: Rule[], remark?: string}[]>([]);
  const [activeProfile, setActiveProfile] = useState<string>('系統預設');

  const [suggestedList, setSuggestedList] = useState<any[]>([]);
  const [warningList, setWarningList] = useState<any[]>([]);
  const [hasGeneratedWarning, setHasGeneratedWarning] = useState(false);
  const [pastCurrentSelection, setPastCurrentSelection] = useState<string>('');
  const [pastPreviousSelection, setPastPreviousSelection] = useState<string>('');
  const [hasGeneratedCompare, setHasGeneratedCompare] = useState(false);
  const [hasGeneratedFinalDiff, setHasGeneratedFinalDiff] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState<'disposal' | 'warning' | 'compare' | 'finalDiff'>('disposal');
  const [activeCompareCategory, setActiveCompareCategory] = useState<'hit' | 'unexpected' | 'watch'>('hit');
  const [activeFinalDiffCategory, setActiveFinalDiffCategory] = useState<'matched' | 'added' | 'kept'>('matched');
  const [finalDiffData, setFinalDiffData] = useState<{
    targetYear: number;
    suggestedCount: number;
    finalCount: number;
    rplCount: number;
    plgCount: number;
    matchedList: any[];
    addedList: any[];
    keptList: any[];
    suggestedIds: string[];
    finalIds: string[];
  }>({
    targetYear: 0,
    suggestedCount: 0,
    finalCount: 0,
    rplCount: 0,
    plgCount: 0,
    matchedList: [],
    addedList: [],
    keptList: [],
    suggestedIds: [],
    finalIds: [],
  });
  const [compareData, setCompareData] = useState<{
    pastWarningCount: number;
    currDisposalCount: number;
    hitList: any[];
    unexpectedList: any[];
    watchList: any[];
    stillWarningCount: number;
    earlyHandledCount: number;
  }>({
    pastWarningCount: 0,
    currDisposalCount: 0,
    hitList: [],
    unexpectedList: [],
    watchList: [],
    stillWarningCount: 0,
    earlyHandledCount: 0,
  });

  const warningInputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pendingLaunchRef = useRef<DecisionLaunchRequest | null>(null);

  // 原始快取資料
  const [tubesData, setTubesData] = useState<any[]>([]);

  useEffect(() => {
    if (launchRequest) {
      pendingLaunchRef.current = launchRequest;
    }
  }, [launchRequest]);

  useEffect(() => {
    // 載入資料庫的公式情境
    fetch(`${import.meta.env.BASE_URL}api/profiles`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSavedProfiles(data);
        }
      })
      .catch(console.error);

    if (!unitData || !unitData.unit_id) return;
    
    setLoading(true);
    fetch(`${import.meta.env.BASE_URL}api/years?unit_id=${unitData.unit_id}`)
      .then(res => res.json())
      .then(async years => {
        if (!Array.isArray(years) || years.length === 0) {
           setLoading(false);
           return;
        }
        
        const sortedYears = years.sort((a,b) => b - a);
        setAvailableYears(sortedYears);

        const maintYears = await fetch(`${import.meta.env.BASE_URL}api/maintenance/years?unit_id=${unitData.unit_id}`).then(r => r.json());
        setMaintenanceYears(maintYears);

        // 初始化選擇
        const latest = sortedYears[0];
        let currSel = `${latest}-before`;
        if (maintYears.includes(latest)) currSel = `${latest}-after`;
        setCurrentSelection(currSel);

        let prevSel = '';
        if (sortedYears.length > 1) {
          const prevY = sortedYears[1];
          prevSel = maintYears.includes(prevY) ? `${prevY}-after` : `${prevY}-before`;
          setPreviousSelection(prevSel);
        }

        const tData = await fetch(`${import.meta.env.BASE_URL}api/tubes?unit_id=${unitData.unit_id}`).then(r => r.json());
        setTubesData(tData);

        setLoading(false);
      })
      .catch(err => {
         console.error(err);
         setLoading(false);
      });
  }, [unitData]);

  useEffect(() => {
    if (!previousSelection || availableYears.length === 0) return;
    const [baseYearStr] = previousSelection.split('-');
    const baseYear = Number(baseYearStr);
    if (!baseYear) return;

    // 前期預警檢測狀態預設為基準年份的「大修檢測基準 (before)」
    const defaultPastCurr = `${baseYear}-before`;
    setPastCurrentSelection(defaultPastCurr);

    // 前期預警基準狀態預設為比 baseYear 更早一期的年份（優先取 after）
    const olderYear = availableYears.find(y => y < baseYear) ?? baseYear;
    const defaultPastPrev = maintenanceYears.includes(olderYear)
      ? `${olderYear}-after`
      : `${olderYear}-before`;
    setPastPreviousSelection(defaultPastPrev);
  }, [previousSelection, availableYears, maintenanceYears]);

  // 當切換比對年份時，重設跨期最終處置比對狀態
  useEffect(() => {
    setHasGeneratedFinalDiff(false);
  }, [currentSelection, previousSelection, unitData]);

  // 處理外部（如資料匯入頁）傳入的一鍵比對跳轉請求
  useEffect(() => {
    if (loading || !pendingLaunchRef.current || availableYears.length === 0) return;
    const req = pendingLaunchRef.current;
    pendingLaunchRef.current = null;

    const targetYear = availableYears.includes(req.targetYear) ? req.targetYear : availableYears[0];
    const nextCurrSel = `${targetYear}-before`;
    const prevY = availableYears.find(y => y < targetYear) ?? targetYear;
    const nextPrevSel = maintenanceYears.includes(prevY) ? `${prevY}-after` : `${prevY}-before`;

    setCurrentSelection(nextCurrSel);
    setPreviousSelection(nextPrevSel);
    runAnalysis(req.tab, nextCurrSel, nextPrevSel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, availableYears, maintenanceYears, tubesData, launchRequest]);

  const fetchStateData = async (selection: string, unitId: string) => {
    if (!selection) return new Map();
    const [yearStr, mode] = selection.split('-');
    const year = Number(yearStr);
    const recordsRes = await fetch(`${import.meta.env.BASE_URL}api/records?unit_id=${unitId}&year=${year}`).then(r => r.json());
    
    let maintenanceRes: any[] = [];
    if (mode === 'after') {
      maintenanceRes = await fetch(`${import.meta.env.BASE_URL}api/maintenance?unit_id=${unitId}&year=${year}`).then(r => r.json());
    }

    const map = new Map<string, any>();
    if (Array.isArray(recordsRes)) {
      recordsRes.forEach(r => {
        const id = `${r.zone}-${r.row_num}-${r.col_num}`;
        let isPlugged = r.code === 'PLG';
        let isReplaced = false;
        let depth = Number(r.size_val) || 0;
        let code = r.code || 'NDD';

        if (mode === 'after') {
          const mainAction = maintenanceRes.find(m => m.zone === r.zone && m.row_num === r.row_num && m.col_num === r.col_num);
          if (mainAction) {
            if (mainAction.action === 'PLG' || mainAction.action === '塞管') {
              isPlugged = true;
            } else if (mainAction.action === 'RPL' || mainAction.action === '換管') {
              isPlugged = false;
              isReplaced = true;
              depth = 0;
              code = 'NDD';
            }
          } else if (maintenanceRes.length === 0) {
            if (depth > 50) isPlugged = true;
            if (code === 'COR') isPlugged = true;
          }
        }
        
        map.set(id, { id, zone: r.zone, depth, isPlugged, isReplaced, code });
      });
    }
    return map;
  };

  const addRule = () => {
    setRules([...rules, { id: Date.now().toString(), formula: '', enabled: true }]);
  };

  const updateRule = (id: string, formula: string) => {
    setRules(rules.map(r => r.id === id ? { ...r, formula } : r));
  };

  const toggleRule = (id: string) => {
    setRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const removeRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id));
  };

  const handleSaveProfile = async () => {
    const name = prompt('請輸入此篩選腳本的名稱 (例如: 嚴格策略)：');
    if (!name) return;
    const remark = prompt('請撰寫備註說明 (選填，例如: 用於大修年度全面檢測)：') || '';
    
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, remark, rules })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(`儲存失敗 (${res.status})：${errData.error || '伺服器錯誤，請確認 decision_profiles 資料表是否已建立。'}`);
        return;
      }
      const newProfiles = [...savedProfiles.filter(p => p.name !== name), { name, remark, rules }];
      setSavedProfiles(newProfiles);
      setActiveProfile(name);
      alert(`✅ 公式「${name}」已成功儲存至伺服器！`);
    } catch (e) {
      alert('儲存失敗，請檢查網路連線或伺服器狀態。');
    }
  };

  const handleLoadProfile = (name: string) => {
    setActiveProfile(name);
    if (name === '系統預設') {
      setRules(DEFAULT_RULES);
      return;
    }
    const profile = savedProfiles.find(p => p.name === name);
    if (profile) {
      setRules(profile.rules);
    }
  };

  const handleDeleteProfile = async () => {
    if (activeProfile === '系統預設') return;
    if (!confirm(`確定要刪除 "${activeProfile}" 嗎？\n此動作將會從資料庫移除，所有使用者皆無法再共用。`)) return;
    
    try {
      await fetch(`${import.meta.env.BASE_URL}api/profiles/${encodeURIComponent(activeProfile)}`, { method: 'DELETE' });
      const newProfiles = savedProfiles.filter(p => p.name !== activeProfile);
      setSavedProfiles(newProfiles);
      setActiveProfile('系統預設');
      setRules(DEFAULT_RULES);
    } catch (e) {
      alert('刪除失敗，請檢查伺服器狀態。');
    }
  };

  const evaluateCycle = (
    currMap: Map<string, any>,
    prevMap: Map<string, any>,
    cycleYear: number,
    activeRules: Rule[],
    trimmedWarning: string,
    shouldEvalWarning: boolean,
    tubeMap: Map<string, any>,
    commissionYear: number
  ) => {
    const suggestions: any[] = [];
    const warnings: any[] = [];
    const suggestionMap = new Map<string, any>();
    const warningMap = new Map<string, any>();
    const currentYear = new Date().getFullYear();

    currMap.forEach((curr, id) => {
      // 已經被塞管的，或因為大修已被判定 PLG 就不算異常管了
      if (curr.isPlugged) return;

      const prev = prevMap.get(id);
      const this_depth = curr.depth;
      const prev_depth = prev ? prev.depth : 0;
      const Code = curr.code;
      const depth_Diff = this_depth > prev_depth ? (this_depth - prev_depth) : 0;

      const tubeMeta = tubeMap.get(id);
      const installYear = tubeMeta?.install_year || commissionYear;
      const TubeAge = cycleYear > 0 ? (cycleYear - installYear) : (currentYear - installYear);

      const context = { TubeAge, depth_Diff, this_depth, previous_depth: prev_depth, Code };

      const matchedRules: string[] = [];
      activeRules.forEach((rule, index) => {
        if (evaluateRule(rule.formula, context)) {
          matchedRules.push(`規則 ${index + 1}: ${rule.formula}`);
        }
      });

      if (matchedRules.length > 0) {
        const item = {
          id,
          quadrant: curr.zone,
          TubeAge,
          this_depth,
          depth_Diff,
          Code,
          reasons: matchedRules,
        };
        suggestions.push(item);
        suggestionMap.set(id, item);
      } else if (shouldEvalWarning && evaluateRule(trimmedWarning, context)) {
        // 排除上方篩選規則後，仍符合警示條件的管束列入警示清單
        const item = {
          id,
          quadrant: curr.zone,
          TubeAge,
          this_depth,
          depth_Diff,
          Code,
          reasons: [`警示條件: ${trimmedWarning}`],
        };
        warnings.push(item);
        warningMap.set(id, item);
      }
    });

    suggestions.sort((a, b) => b.this_depth - a.this_depth);
    warnings.sort((a, b) => b.this_depth - a.this_depth);
    return { suggestions, warnings, suggestionMap, warningMap };
  };

  const runAnalysis = async (
    targetMode: 'disposal' | 'warning' | 'compare' | 'finalDiff' = 'disposal',
    overrideCurrSel?: string,
    overridePrevSel?: string
  ) => {
    const effectiveCurrSel = overrideCurrSel || currentSelection;
    const effectivePrevSel = overridePrevSel || previousSelection;
    if (!effectiveCurrSel || !effectivePrevSel) return;

    const trimmedWarning = warningFormula.trim();
    if (targetMode === 'warning' || targetMode === 'compare') {
      if (!trimmedWarning) {
        setWarningFormulaError('請輸入警示條件公式');
        warningInputRef.current?.focus();
        return;
      }
      if (!isFormulaSyntaxValid(trimmedWarning)) {
        setWarningFormulaError('警示條件公式語法有誤，請檢查變數名稱與運算子');
        warningInputRef.current?.focus();
        return;
      }
      setWarningFormulaError('');
    }

    setAnalyzing(true);

    try {
      const [currYearStr, currMode] = effectiveCurrSel.split('-');
      const latestYear = Number(currYearStr);
      const targetHasMaint = latestYear > 0 && maintenanceYears.includes(latestYear);

      const shouldRunCompare =
        (targetMode === 'compare' || hasGeneratedCompare) &&
        Boolean(pastCurrentSelection) &&
        Boolean(pastPreviousSelection) &&
        isFormulaSyntaxValid(trimmedWarning);

      const shouldRunFinalDiff =
        targetHasMaint &&
        (targetMode === 'finalDiff' || targetMode === 'disposal' || hasGeneratedFinalDiff);

      const [[currMap, prevMap], pastMaps, finalDiffInputs] = await Promise.all([
        Promise.all([
          fetchStateData(effectiveCurrSel, unitData.unit_id),
          fetchStateData(effectivePrevSel, unitData.unit_id)
        ]),
        shouldRunCompare
          ? Promise.all([
              fetchStateData(pastCurrentSelection, unitData.unit_id),
              fetchStateData(pastPreviousSelection, unitData.unit_id)
            ])
          : Promise.resolve<[Map<string, any>, Map<string, any>] | null>(null),
        shouldRunFinalDiff
          ? Promise.all([
              fetch(`${import.meta.env.BASE_URL}api/maintenance?unit_id=${unitData.unit_id}&year=${latestYear}`).then(r => r.json()),
              currMode === 'after'
                ? fetchStateData(`${latestYear}-before`, unitData.unit_id)
                : Promise.resolve<Map<string, any> | null>(null)
            ])
          : Promise.resolve<[any[], Map<string, any> | null] | null>(null)
      ]);

      const activeRules = rules.filter(r => r.enabled && r.formula.trim().length > 0);
      const shouldEvaluateWarning =
        (targetMode === 'warning' || targetMode === 'compare' || hasGeneratedWarning || hasGeneratedCompare) &&
        isFormulaSyntaxValid(trimmedWarning);

      const commissionYear = unitData.commission_year || 2018;

      const tubeMap = new Map();
      if (Array.isArray(tubesData)) {
        tubesData.forEach(t => {
          tubeMap.set(`${t.zone}-${t.row_num}-${t.col_num}`, t);
        });
      }

      const currCycle = evaluateCycle(
        currMap,
        prevMap,
        latestYear,
        activeRules,
        trimmedWarning,
        shouldEvaluateWarning,
        tubeMap,
        commissionYear
      );

      setSuggestedList(currCycle.suggestions);
      if (shouldEvaluateWarning) {
        setWarningList(currCycle.warnings);
      }
      if (targetMode === 'warning') {
        setHasGeneratedWarning(true);
      }

      if (shouldRunFinalDiff && finalDiffInputs) {
        const [maintRows, beforeMapOverride] = finalDiffInputs;
        const preMaintMap = beforeMapOverride || currMap;
        const evalWarnForFinal = isFormulaSyntaxValid(trimmedWarning);
        const sugCycle = beforeMapOverride
          ? evaluateCycle(preMaintMap, prevMap, latestYear, activeRules, trimmedWarning, evalWarnForFinal, tubeMap, commissionYear)
          : (evalWarnForFinal && !shouldEvaluateWarning
              ? evaluateCycle(preMaintMap, prevMap, latestYear, activeRules, trimmedWarning, true, tubeMap, commissionYear)
              : currCycle);

        const maintById = new Map<string, any>();
        const actualDisposals = new Map<string, any>();
        let rplCount = 0;
        let plgCount = 0;

        if (Array.isArray(maintRows)) {
          maintRows.forEach((m: any) => {
            const z = String(m.zone || '').trim().toUpperCase();
            const id = `${z}-${m.row_num}-${m.col_num}`;
            const normAction = normalizeMaintAction(m.action);
            const enriched = { ...m, zone: z, normAction };
            maintById.set(id, enriched);
            if (normAction === 'RPL' || normAction === 'PLG') {
              actualDisposals.set(id, enriched);
              if (normAction === 'RPL') rplCount++;
              else plgCount++;
            }
          });
        }

        const matchedList: any[] = [];
        const addedList: any[] = [];
        const keptList: any[] = [];

        sugCycle.suggestions.forEach(sug => {
          const disp = actualDisposals.get(sug.id);
          if (disp) {
            matchedList.push({
              ...sug,
              action: disp.normAction,
              new_material: disp.new_material || '',
              maintNotes: disp.notes || '',
            });
          } else {
            const anyMaint = maintById.get(sug.id);
            keptList.push({
              ...sug,
              action: 'KEP',
              new_material: '',
              maintNotes: anyMaint?.notes || '',
            });
          }
        });

        actualDisposals.forEach((disp, id) => {
          if (sugCycle.suggestionMap.has(id)) return;
          const rawCurr = preMaintMap.get(id);
          const rawPrev = prevMap.get(id);
          const tubeMeta = tubeMap.get(id);
          const this_depth = rawCurr ? rawCurr.depth : 0;
          const prev_depth = rawPrev ? rawPrev.depth : 0;
          const depth_Diff = this_depth > prev_depth ? (this_depth - prev_depth) : 0;
          const installYear = tubeMeta?.install_year || commissionYear;
          const TubeAge = latestYear > 0 ? (latestYear - installYear) : 0;
          const isWarn = sugCycle.warningMap.has(id);

          addedList.push({
            id,
            quadrant: disp.zone,
            TubeAge,
            this_depth,
            depth_Diff,
            Code: rawCurr?.code || 'NDD',
            reasons: isWarn ? [`未達處置門檻（符合警示: ${trimmedWarning}）`] : ['未達建議公式門檻'],
            action: disp.normAction,
            new_material: disp.new_material || '',
            maintNotes: disp.notes || '',
          });
        });

        matchedList.sort((a, b) => b.this_depth - a.this_depth);
        addedList.sort((a, b) => b.this_depth - a.this_depth);
        keptList.sort((a, b) => b.this_depth - a.this_depth);

        setFinalDiffData({
          targetYear: latestYear,
          suggestedCount: sugCycle.suggestions.length,
          finalCount: actualDisposals.size,
          rplCount,
          plgCount,
          matchedList,
          addedList,
          keptList,
          suggestedIds: sugCycle.suggestions.map(s => s.id),
          finalIds: Array.from(actualDisposals.keys()),
        });
        setHasGeneratedFinalDiff(true);
      } else if (targetMode === 'finalDiff') {
        setHasGeneratedFinalDiff(false);
      }

      if (shouldRunCompare && pastMaps) {
        const [pastCurrMap, pastPrevMap] = pastMaps;
        const [pastYearStr] = pastCurrentSelection.split('-');
        const pastYear = Number(pastYearStr);

        const pastCycle = evaluateCycle(
          pastCurrMap,
          pastPrevMap,
          pastYear,
          activeRules,
          trimmedWarning,
          true,
          tubeMap,
          commissionYear
        );

        const hitList: any[] = [];
        const unexpectedList: any[] = [];
        const watchList: any[] = [];
        let stillWarningCount = 0;
        let earlyHandledCount = 0;

        currCycle.suggestions.forEach(item => {
          const pastWarn = pastCycle.warningMap.get(item.id);
          if (pastWarn) {
            hitList.push({
              ...item,
              past_depth: pastWarn.this_depth,
              curr_depth: item.this_depth,
              cross_diff: item.this_depth - pastWarn.this_depth,
              statusLabel: '預警命中',
            });
          } else {
            const pastRaw = pastCurrMap.get(item.id);
            const pastDepth = pastRaw ? pastRaw.depth : 0;
            unexpectedList.push({
              ...item,
              past_depth: pastDepth,
              curr_depth: item.this_depth,
              cross_diff: item.this_depth - pastDepth,
              statusLabel: '突發處置（前期未警示）',
            });
          }
        });

        pastCycle.warnings.forEach(pastItem => {
          if (currCycle.suggestionMap.has(pastItem.id)) return;
          const currRaw = currMap.get(pastItem.id);
          const prevRaw = prevMap.get(pastItem.id);
          const isStillWarn = currCycle.warningMap.has(pastItem.id);
          const currDepth = currRaw ? currRaw.depth : 0;
          const isPluggedNow = Boolean(currRaw?.isPlugged || prevRaw?.isPlugged);

          let outcome = '未達處置與警示門檻';
          if (isPluggedNow) {
            outcome = '前期已塞管處置';
            earlyHandledCount++;
          } else if (prevRaw?.isReplaced || (currRaw && currRaw.depth < pastItem.this_depth - 15)) {
            outcome = '前期已換管 / 深度降低';
            earlyHandledCount++;
          } else if (isStillWarn) {
            outcome = '持續警示（劣化平緩）';
            stillWarningCount++;
          }

          watchList.push({
            ...pastItem,
            past_depth: pastItem.this_depth,
            curr_depth: currDepth,
            this_depth: currDepth,
            cross_diff: currDepth - pastItem.this_depth,
            isPluggedNow,
            statusLabel: outcome,
            reasons: [outcome],
          });
        });

        hitList.sort((a, b) => b.curr_depth - a.curr_depth);
        unexpectedList.sort((a, b) => b.curr_depth - a.curr_depth);
        watchList.sort((a, b) => b.past_depth - a.past_depth);

        setCompareData({
          pastWarningCount: pastCycle.warnings.length,
          currDisposalCount: currCycle.suggestions.length,
          hitList,
          unexpectedList,
          watchList,
          stillWarningCount,
          earlyHandledCount,
        });
        if (targetMode === 'compare') {
          setHasGeneratedCompare(true);
        }
      }

      setActiveResultTab(targetMode);
    } catch (e) {
      console.error(e);
    } finally {
      setAnalyzing(false);
    }
  };

  const formatSelectionLabel = (sel: string) => {
    if (!sel) return '-';
    const [y, m] = sel.split('-');
    return `${y}(${m === 'after' ? '大修後' : '檢測基準'})`;
  };

  const exportRowsToExcel = (
    list: any[],
    sheetName: string,
    fileName: string,
    conditionHeader = '觸發條件'
  ) => {
    if (list.length === 0) return;
    const rows = list.map(item => {
      const parts = item.id.split('-');
      return {
        '區域': parts[0] || '',
        '行/Row': Number(parts[1]) || parts[1] || '',
        '列/Col': Number(parts[2]) || parts[2] || '',
        '管齡(年)': item.TubeAge,
        '本次深度(%)': parseFloat(item.this_depth.toFixed(1)),
        '深度差異(%)': parseFloat(item.depth_Diff.toFixed(1)),
        [conditionHeader]: item.reasons.map(formatReasonForExcel).join(' | ')
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    // 設定欄寬
    ws['!cols'] = [
      { wch: 8 },  // 區域
      { wch: 8 },  // 行/Row
      { wch: 8 },  // 列/Col
      { wch: 10 }, // 管齡
      { wch: 14 }, // 本次深度
      { wch: 14 }, // 深度差異
      { wch: 65 }, // 觸發條件 / 警示條件
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  };

  const exportDisposalTemplate = (list: any[]) => {
    if (list.length === 0) return;
    const [yearStr] = currentSelection.split('-');
    const targetYear = Number(yearStr) || new Date().getFullYear();
    const rows = list.map(item => {
      const parts = item.id.split('-');
      return {
        '機組/Unit': unitData.unit_id,
        '年份': targetYear,
        '區域/Zone': parts[0] || '',
        '行/Row': Number(parts[1]) || parts[1] || '',
        '列/Col': Number(parts[2]) || parts[2] || '',
        '處置/action': '',
        '新材質/new_material': '',
        '備註/notes': '',
        '本次深度(%)': parseFloat(item.this_depth.toFixed(1)),
        '建議觸發條件': item.reasons.map(formatReasonForExcel).join(' | '),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 10 },
      { wch: 8 },
      { wch: 10 },
      { wch: 8 },
      { wch: 8 },
      { wch: 14 },
      { wch: 16 },
      { wch: 24 },
      { wch: 12 },
      { wch: 52 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '大修處置底稿');
    XLSX.writeFile(wb, `${unitData.unit_id}_${targetYear}_大修處置底稿.xlsx`);
  };

  const exportFinalDiffToExcel = () => {
    if (!hasGeneratedFinalDiff) return;
    const wb = XLSX.utils.book_new();
    const buildSheet = (list: any[], sheetName: string) => {
      const rows = list.map(item => {
        const parts = item.id.split('-');
        return {
          '區域': parts[0] || '',
          '行/Row': Number(parts[1]) || parts[1] || '',
          '列/Col': Number(parts[2]) || parts[2] || '',
          '管齡(年)': item.TubeAge,
          '本次深度(%)': parseFloat(item.this_depth.toFixed(1)),
          '深度差異(%)': parseFloat(item.depth_Diff.toFixed(1)),
          '建議觸發條件': item.reasons.map(formatReasonForExcel).join(' | '),
          '最終處置(After)': formatMaintActionLabel(item.action),
          '新材質': item.new_material || '',
          '處置備註': item.maintNotes || '',
        };
      });
      const ws = XLSX.utils.json_to_sheet(
        rows.length > 0
          ? rows
          : [{ '區域': '無符合資料', '行/Row': '', '列/Col': '', '管齡(年)': '', '本次深度(%)': '', '深度差異(%)': '', '建議觸發條件': '', '最終處置(After)': '', '新材質': '', '處置備註': '' }]
      );
      ws['!cols'] = [
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 10 },
        { wch: 14 },
        { wch: 14 },
        { wch: 48 },
        { wch: 16 },
        { wch: 14 },
        { wch: 28 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    };

    buildSheet(finalDiffData.matchedList, '1_依建議執行');
    buildSheet(finalDiffData.addedList, '2_決策額外新增');
    buildSheet(finalDiffData.keptList, '3_建議但最終保留');
    XLSX.writeFile(wb, `${unitData.unit_id}_${finalDiffData.targetYear}_最終處置與建議比對.xlsx`);
  };

  const exportCompareToExcel = () => {
    if (!hasGeneratedCompare) return;
    const wb = XLSX.utils.book_new();
    const buildSheet = (list: any[], sheetName: string) => {
      const rows = list.map(item => {
        const parts = item.id.split('-');
        return {
          '區域': parts[0] || '',
          '行/Row': Number(parts[1]) || parts[1] || '',
          '列/Col': Number(parts[2]) || parts[2] || '',
          '管齡(年)': item.TubeAge,
          '前期深度(%)': parseFloat(item.past_depth.toFixed(1)),
          '本次深度(%)': item.isPluggedNow ? '已塞管' : parseFloat(item.curr_depth.toFixed(1)),
          '跨期變化(%)': item.isPluggedNow ? '-' : parseFloat(item.cross_diff.toFixed(1)),
          '分類狀態': item.statusLabel,
          '觸發條件 / 目前去向': item.reasons.map(formatReasonForExcel).join(' | '),
        };
      });
      const ws = XLSX.utils.json_to_sheet(
        rows.length > 0
          ? rows
          : [{ '區域': '無符合資料', '行/Row': '', '列/Col': '', '管齡(年)': '', '前期深度(%)': '', '本次深度(%)': '', '跨期變化(%)': '', '分類狀態': '', '觸發條件 / 目前去向': '' }]
      );
      ws['!cols'] = [
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 10 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 24 },
        { wch: 60 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    };

    buildSheet(compareData.hitList, '1_預警命中');
    buildSheet(compareData.unexpectedList, '2_突發處置');
    buildSheet(compareData.watchList, '3_緩慢劣化與已處理');
    XLSX.writeFile(wb, `${unitData.unit_id}_預警追蹤比對.xlsx`);
  };

  if (!unitData || !unitData.unit_id) {
    return (
      <div className="flex flex-col items-center justify-center p-20 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
        <Database className="w-12 h-12 text-slate-700 mb-4 animate-pulse" />
        <h3 className="text-xl font-bold text-slate-300">尚未載入機組資料</h3>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <h3 className="text-xl font-bold text-slate-300">載入歷史與管束資料中...</h3>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold text-white">處置篩選系統 {unitData.commission_year && <span className="text-sm font-normal text-slate-400 ml-2">(建廠年份: {unitData.commission_year})</span>}</h2>
        <p className="text-slate-400">定義篩選條件公式，快速從數千筆檢測資料中找出高風險管束</p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 px-4 py-3 bg-slate-900/50 border border-slate-800 rounded-lg">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-300 whitespace-nowrap">本次比對狀態:</label>
            <select 
              value={currentSelection} 
              onChange={(e) => setCurrentSelection(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-1.5 text-sm focus:ring-blue-500 focus:border-blue-500 font-medium"
            >
              {availableYears.map(y => (
                <optgroup key={`curr-${y}`} label={`${y} 年份`}>
                  {maintenanceYears.includes(y) && (
                    <option value={`${y}-after`}>{y} (大修處理後)</option>
                  )}
                  <option value={`${y}-before`}>{y} (大修檢測基準)</option>
                </optgroup>
              ))}
            </select>
          </div>
          <div className="hidden sm:block text-slate-500 font-bold px-4 py-1 bg-slate-800/50 rounded-lg">VS</div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-300 whitespace-nowrap">基準比對狀態:</label>
            <select 
              value={previousSelection} 
              onChange={(e) => setPreviousSelection(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-3 py-1.5 text-sm focus:ring-blue-500 focus:border-blue-500 font-medium"
            >
              {availableYears.map(y => (
                <optgroup key={`prev-${y}`} label={`${y} 年份`}>
                  {maintenanceYears.includes(y) && (
                    <option value={`${y}-after`}>{y} (大修處理後)</option>
                  )}
                  <option value={`${y}-before`}>{y} (大修檢測基準)</option>
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        
        {/* 公式腳本存取 */}
        <div className="flex flex-col gap-2 pl-0 sm:pl-6 sm:border-l border-slate-700 w-full sm:w-auto">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-blue-400 whitespace-nowrap">
              <Bookmark size={16} />
              <span className="text-sm font-medium">套用公式:</span>
            </div>
            <select
              value={activeProfile}
              onChange={(e) => handleLoadProfile(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-blue-300 rounded-md px-3 py-1.5 text-sm font-bold min-w-[120px]"
            >
              <option value="系統預設">系統預設</option>
              {savedProfiles.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <button 
              onClick={handleSaveProfile}
              className="flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1.5 rounded transition whitespace-nowrap"
              title="將當前公式組合儲存至資料庫"
            >
              <Save size={14} /> 儲存目前組合
            </button>
            {activeProfile !== '系統預設' && (
              <button 
                onClick={handleDeleteProfile}
                className="p-1.5 text-red-400 hover:bg-red-500/20 rounded"
                title="從資料庫刪除"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {activeProfile !== '系統預設' && savedProfiles.find(p => p.name === activeProfile)?.remark && (
            <div className="text-xs text-slate-400 italic">
              ↳ 備註: {savedProfiles.find(p => p.name === activeProfile)?.remark}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800 h-fit">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Settings2 className="text-blue-500" />
              <h3 className="text-lg font-semibold text-slate-100">自訂篩選公式</h3>
            </div>
            <button 
              onClick={addRule}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded flex items-center gap-1"
            >
              <Plus size={14} /> 新增
            </button>
          </div>
          
          <div className="space-y-3">
            {rules.map((rule, i) => (
              <div key={rule.id} className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      checked={rule.enabled} 
                      onChange={() => toggleRule(rule.id)}
                      className="accent-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-300">規則 {i + 1}</span>
                  </div>
                  <button onClick={() => removeRule(rule.id)} className="text-slate-500 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
                <input 
                  type="text"
                  value={rule.formula}
                  onChange={(e) => updateRule(rule.id, e.target.value)}
                  placeholder={`例如: TubeAge >= 6 and this_depth > 40`}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-blue-300 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800 space-y-4">
            <button
              type="button"
              onClick={() => runAnalysis('disposal')}
              disabled={analyzing}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {analyzing ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
              {analyzing ? '篩選運算中...' : '執行篩選'}
            </button>

            <div className="bg-amber-950/20 border border-amber-500/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-400 shrink-0" aria-hidden="true" />
                <label htmlFor="warning-formula-input" className="text-sm font-semibold text-amber-200">
                  警示條件公式
                </label>
              </div>
              <p id="warning-formula-help" className="text-xs text-slate-400">
                排除上方篩選規則命中的管束後，符合此條件將列入警示清單
              </p>
              <input
                ref={warningInputRef}
                id="warning-formula-input"
                name="warningFormula"
                type="text"
                value={warningFormula}
                onChange={(e) => {
                  setWarningFormula(e.target.value);
                  if (warningFormulaError) setWarningFormulaError('');
                }}
                placeholder="例如: this_depth >= 40"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={warningFormulaError ? 'true' : undefined}
                aria-describedby={warningFormulaError ? 'warning-formula-help warning-formula-error' : 'warning-formula-help'}
                className={`w-full bg-slate-900 border rounded px-3 py-2 text-sm text-amber-200 font-mono focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${
                  warningFormulaError ? 'border-red-500' : 'border-slate-700 focus:border-amber-500'
                }`}
              />
              {warningFormulaError && (
                <p id="warning-formula-error" role="alert" className="text-xs text-red-400">
                  {warningFormulaError}
                </p>
              )}
              <button
                type="button"
                onClick={() => runAnalysis('warning')}
                disabled={analyzing}
                className="w-full bg-amber-600 hover:bg-amber-500 text-white font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {analyzing ? <Loader2 size={18} className="animate-spin" /> : <AlertTriangle size={18} />}
                {analyzing ? '警示運算中...' : '產出警示清單'}
              </button>
              <button
                type="button"
                onClick={() => runAnalysis('compare')}
                disabled={analyzing}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {analyzing ? <Loader2 size={18} className="animate-spin" /> : <GitCompare size={18} />}
                {analyzing ? '比對運算中...' : '預警追蹤比對'}
              </button>
            </div>

            <div className="text-xs text-slate-400 font-mono bg-slate-950 p-3 rounded">
              可使用變數：<br/>
              • <span className="text-blue-400">TubeAge</span>: 管齡(年)<br/>
              • <span className="text-blue-400">depth_Diff</span>: 深度差異(%)<br/>
              • <span className="text-blue-400">this_depth</span>: 當前深度(%)<br/>
              • <span className="text-blue-400">previous_depth</span>: 前次深度(%)<br/>
              • <span className="text-blue-400">Code</span>: 種類字串(例如 "COR")
            </div>

            <div
              tabIndex={0}
              role="region"
              aria-labelledby="code-reference-caption"
              className="bg-slate-950 p-3 rounded border border-slate-800/80 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              <table className="w-full text-left border-collapse text-xs">
                <caption
                  id="code-reference-caption"
                  className="text-left text-slate-400 font-mono mb-2"
                >
                  CODE 對照說明：
                </caption>
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th scope="col" className="py-1.5 pr-3 font-semibold font-mono whitespace-nowrap">CODE</th>
                    <th scope="col" className="py-1.5 font-semibold">代表意義</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {CODE_DEFINITIONS.map(({ code, label }) => (
                    <tr key={code}>
                      <th scope="row" className="py-1.5 pr-3 font-mono font-semibold text-blue-400 whitespace-nowrap">
                        {code}
                      </th>
                      <td className="py-1.5 text-slate-300">{label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-800">
          <div
            role="tablist"
            aria-label="篩選結果清單"
            className="flex overflow-x-auto border-b border-slate-800 mb-5 gap-2"
            onKeyDown={(e) => {
              const tabOrder: Array<'disposal' | 'warning' | 'compare' | 'finalDiff'> = ['disposal', 'warning', 'compare', 'finalDiff'];
              const currentIdx = tabOrder.indexOf(activeResultTab);
              let nextIdx = currentIdx;
              if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % tabOrder.length;
              else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + tabOrder.length) % tabOrder.length;
              else if (e.key === 'Home') nextIdx = 0;
              else if (e.key === 'End') nextIdx = tabOrder.length - 1;
              else return;
              e.preventDefault();
              setActiveResultTab(tabOrder[nextIdx]);
              tabRefs.current[nextIdx]?.focus();
            }}
          >
            <button
              ref={(el) => { tabRefs.current[0] = el; }}
              type="button"
              role="tab"
              id="tab-disposal"
              aria-selected={activeResultTab === 'disposal'}
              tabIndex={activeResultTab === 'disposal' ? 0 : -1}
              onClick={() => setActiveResultTab('disposal')}
              className={`relative flex-none pb-3 px-4 text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                activeResultTab === 'disposal'
                  ? "text-white after:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:border-b-2 after:border-blue-400"
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldAlert size={16} className="text-red-500" aria-hidden="true" />
              <span>建議處置清單</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400">
                {suggestedList.length}
              </span>
            </button>
            <button
              ref={(el) => { tabRefs.current[1] = el; }}
              type="button"
              role="tab"
              id="tab-warning"
              aria-selected={activeResultTab === 'warning'}
              tabIndex={activeResultTab === 'warning' ? 0 : -1}
              onClick={() => setActiveResultTab('warning')}
              className={`relative flex-none pb-3 px-4 text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${
                activeResultTab === 'warning'
                  ? "text-white after:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:border-b-2 after:border-amber-400"
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <AlertTriangle size={16} className="text-amber-400" aria-hidden="true" />
              <span>警示清單</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-400">
                {warningList.length}
              </span>
            </button>
            <button
              ref={(el) => { tabRefs.current[2] = el; }}
              type="button"
              role="tab"
              id="tab-compare"
              aria-selected={activeResultTab === 'compare'}
              tabIndex={activeResultTab === 'compare' ? 0 : -1}
              onClick={() => setActiveResultTab('compare')}
              className={`relative flex-none pb-3 px-4 text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 ${
                activeResultTab === 'compare'
                  ? "text-white after:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:border-b-2 after:border-indigo-400"
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitCompare size={16} className="text-indigo-400" aria-hidden="true" />
              <span>預警追蹤比對</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900/30 text-indigo-300">
                {hasGeneratedCompare ? `${compareData.hitList.length}/${compareData.currDisposalCount}` : '比對'}
              </span>
            </button>
            <button
              ref={(el) => { tabRefs.current[3] = el; }}
              type="button"
              role="tab"
              id="tab-finalDiff"
              aria-selected={activeResultTab === 'finalDiff'}
              tabIndex={activeResultTab === 'finalDiff' ? 0 : -1}
              onClick={() => {
                setActiveResultTab('finalDiff');
                const [yStr] = currentSelection.split('-');
                const targetY = Number(yStr);
                if (targetY && maintenanceYears.includes(targetY) && !hasGeneratedFinalDiff && !analyzing) {
                  runAnalysis('finalDiff');
                }
              }}
              className={`relative flex-none pb-3 px-4 text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${
                activeResultTab === 'finalDiff'
                  ? "text-white after:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:border-b-2 after:border-emerald-400"
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 size={16} className="text-emerald-400" aria-hidden="true" />
              <span>最終處置比對</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-300">
                {hasGeneratedFinalDiff ? `${finalDiffData.finalCount}/${finalDiffData.suggestedCount}` : 'After'}
              </span>
            </button>
          </div>

          {[
            {
              key: 'disposal' as const,
              tabId: 'tab-disposal',
              title: '建議處置清單',
              icon: <ShieldAlert className="text-red-500" aria-hidden="true" />,
              items: suggestedList,
              downloadLabel: '處置清單下載',
              sheetName: '建議處置清單',
              fileName: `${unitData.unit_id}_建議處置清單.xlsx`,
              conditionHeader: '觸發條件',
              badgeClass: 'bg-red-900/20 text-red-400',
              badgeText: `共 ${suggestedList.length} 支管需處理`,
              depthClass: 'text-red-400',
              emptyText: '目前無符合條件的建議項目，點擊「執行篩選」開始檢查。',
            },
            {
              key: 'warning' as const,
              tabId: 'tab-warning',
              title: '警示清單',
              icon: <AlertTriangle className="text-amber-400" aria-hidden="true" />,
              items: warningList,
              downloadLabel: '警示清單下載',
              sheetName: '警示清單',
              fileName: `${unitData.unit_id}_警示清單.xlsx`,
              conditionHeader: '警示條件',
              badgeClass: 'bg-amber-900/20 text-amber-400',
              badgeText: `共 ${warningList.length} 支管需注意`,
              depthClass: 'text-amber-400',
              emptyText: hasGeneratedWarning
                ? '目前無符合警示條件的項目（已排除處置篩選管束）。'
                : '目前尚未產出警示清單，點擊「產出警示清單」開始檢查。',
            },
          ].map((panel) => (
            <div
              key={panel.key}
              role="tabpanel"
              aria-labelledby={panel.tabId}
              hidden={activeResultTab !== panel.key}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  {panel.icon}
                  <h3 className="text-lg font-semibold text-slate-100">{panel.title}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {onApplyToVisual && (
                    <button
                      type="button"
                      onClick={() => {
                        const [sourceYearStr] = currentSelection.split('-');
                        const [baseYearStr] = previousSelection.split('-');
                        const sourceYear = Number(sourceYearStr);
                        const ids = panel.items.map(item => item.id);
                        onApplyToVisual({
                          ids,
                          suggestedIds: panel.key === 'disposal' ? ids : undefined,
                          finalIds: panel.key === 'disposal' && hasGeneratedFinalDiff && finalDiffData.targetYear === sourceYear
                            ? finalDiffData.finalIds
                            : undefined,
                          sourceYear,
                          baseYear: Number(baseYearStr),
                          mode: 'suggested',
                          origin: 'decision',
                        });
                      }}
                      disabled={panel.items.length === 0}
                      className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                      title="將結果套用至動態視覺檢視的畫布上"
                    >
                      <Play size={14} /> 在視覺圖中檢視
                    </button>
                  )}
                  {panel.key === 'disposal' && (
                    <button
                      type="button"
                      onClick={() => exportDisposalTemplate(panel.items)}
                      disabled={panel.items.length === 0}
                      className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                      title="匯出含處置/action與新材質欄位的 Excel 底稿，編輯後可直接上傳至大修處置 (After)"
                    >
                      <FileSpreadsheet size={14} /> 匯出處置底稿
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => exportRowsToExcel(panel.items, panel.sheetName, panel.fileName, panel.conditionHeader)}
                    disabled={panel.items.length === 0}
                    className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                  >
                    <Download size={14} /> {panel.downloadLabel}
                  </button>
                  <div className={`text-sm font-medium px-3 py-1 rounded-full ${panel.badgeClass}`}>
                    {panel.badgeText}
                  </div>
                </div>
              </div>

              <div
                tabIndex={0}
                role="region"
                aria-label={panel.title}
                className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-900 shadow-sm z-10">
                    <tr className="bg-slate-800/50 border-y border-slate-800">
                      <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">區域</th>
                      <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">行/Row</th>
                      <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">列/Col</th>
                      <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">管齡</th>
                      <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">本次深度</th>
                      <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400 whitespace-nowrap">深度差異</th>
                      <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">{panel.conditionHeader}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {panel.items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/50">
                        {(() => { const parts = item.id.split('-'); return (<>
                          <td className="py-3 px-4 text-sm font-bold text-blue-300">{parts[0]}</td>
                          <td className="py-3 px-4 text-sm font-medium text-white">{parts[1]}</td>
                          <td className="py-3 px-4 text-sm font-medium text-white">{parts[2]}</td>
                        </>); })()}
                        <td className="py-3 px-4 text-sm text-slate-300">{item.TubeAge} 年</td>
                        <td className={`py-3 px-4 text-sm font-bold ${panel.depthClass}`}>{item.this_depth.toFixed(1)}%</td>
                        <td className="py-3 px-4 text-sm font-bold text-amber-500">
                          +{item.depth_Diff.toFixed(1)}%
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-400 max-w-[200px]">
                          <ul className="list-disc pl-4 space-y-0.5">
                            {item.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                          </ul>
                        </td>
                      </tr>
                    ))}
                    {panel.items.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          {panel.emptyText}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div
            role="tabpanel"
            aria-labelledby="tab-compare"
            hidden={activeResultTab !== 'compare'}
          >
            {/* 前期預警週期選擇列 */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 border border-slate-800 rounded-lg p-3 mb-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="past-curr-select" className="text-xs font-medium text-slate-300 whitespace-nowrap">
                    前期預警檢測:
                  </label>
                  <select
                    id="past-curr-select"
                    value={pastCurrentSelection}
                    onChange={(e) => setPastCurrentSelection(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-slate-200 rounded px-2.5 py-1 text-xs font-medium focus:border-indigo-500"
                  >
                    {availableYears.map(y => (
                      <optgroup key={`past-curr-${y}`} label={`${y} 年份`}>
                        {maintenanceYears.includes(y) && (
                          <option value={`${y}-after`}>{y} (大修處理後)</option>
                        )}
                        <option value={`${y}-before`}>{y} (大修檢測基準)</option>
                      </optgroup>
                    ))}
                  </select>
                </div>
                <span className="text-xs font-bold text-slate-500">VS</span>
                <div className="flex items-center gap-2">
                  <label htmlFor="past-prev-select" className="text-xs font-medium text-slate-300 whitespace-nowrap">
                    前期預警基準:
                  </label>
                  <select
                    id="past-prev-select"
                    value={pastPreviousSelection}
                    onChange={(e) => setPastPreviousSelection(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-slate-200 rounded px-2.5 py-1 text-xs font-medium focus:border-indigo-500"
                  >
                    {availableYears.map(y => (
                      <optgroup key={`past-prev-${y}`} label={`${y} 年份`}>
                        {maintenanceYears.includes(y) && (
                          <option value={`${y}-after`}>{y} (大修處理後)</option>
                        )}
                        <option value={`${y}-before`}>{y} (大修檢測基準)</option>
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                onClick={() => runAnalysis('compare')}
                disabled={analyzing || !pastCurrentSelection || !pastPreviousSelection}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors"
              >
                {analyzing ? <Loader2 size={14} className="animate-spin" /> : <GitCompare size={14} />}
                重新比對
              </button>
            </div>

            {/* 三分類統計卡片 */}
            {(() => {
              const hitRate = compareData.pastWarningCount > 0
                ? ((compareData.hitList.length / compareData.pastWarningCount) * 100).toFixed(1)
                : '0.0';
              const coverageRate = compareData.currDisposalCount > 0
                ? ((compareData.hitList.length / compareData.currDisposalCount) * 100).toFixed(1)
                : '0.0';
              const unexpectedRate = compareData.currDisposalCount > 0
                ? ((compareData.unexpectedList.length / compareData.currDisposalCount) * 100).toFixed(1)
                : '0.0';

              const cards = [
                {
                  key: 'hit' as const,
                  title: '① 預警命中',
                  subtitle: '過去警示 → 本次處置',
                  count: compareData.hitList.length,
                  detail: `預警轉化率 ${hitRate}% | 處置涵蓋率 ${coverageRate}%`,
                  activeClass: 'border-emerald-500 bg-emerald-950/30',
                  countClass: 'text-emerald-400',
                },
                {
                  key: 'unexpected' as const,
                  title: '② 突發處置',
                  subtitle: '過去未警示 → 本次處置',
                  count: compareData.unexpectedList.length,
                  detail: `佔本次處置 ${unexpectedRate}%（非預期快速劣化）`,
                  activeClass: 'border-red-500 bg-red-950/30',
                  countClass: 'text-red-400',
                },
                {
                  key: 'watch' as const,
                  title: '③ 緩慢劣化 / 已處理',
                  subtitle: '過去警示 → 本次未達處置',
                  count: compareData.watchList.length,
                  detail: `持續警示 ${compareData.stillWarningCount} 支 | 前期已處置 ${compareData.earlyHandledCount} 支`,
                  activeClass: 'border-sky-500 bg-sky-950/30',
                  countClass: 'text-sky-400',
                },
              ];

              const activeCategoryMeta = cards.find(c => c.key === activeCompareCategory) || cards[0];
              const activeCategoryItems =
                activeCompareCategory === 'hit'
                  ? compareData.hitList
                  : activeCompareCategory === 'unexpected'
                    ? compareData.unexpectedList
                    : compareData.watchList;

              return (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div className="flex items-center justify-between bg-amber-950/20 border border-amber-500/30 rounded-lg px-4 py-2.5">
                      <div>
                        <div className="text-xs font-semibold text-amber-300">過去示警總數</div>
                        <div className="text-[11px] text-slate-400">
                          ① 預警命中 ({compareData.hitList.length}) + ③ 緩慢劣化/已處理 ({compareData.watchList.length})
                        </div>
                      </div>
                      <div className="text-xl font-bold tabular-nums text-amber-400">
                        {compareData.pastWarningCount} <span className="text-xs font-normal text-slate-400">支</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-red-950/20 border border-red-500/30 rounded-lg px-4 py-2.5">
                      <div>
                        <div className="text-xs font-semibold text-red-300">本次建議處置總數</div>
                        <div className="text-[11px] text-slate-400">
                          ① 預警命中 ({compareData.hitList.length}) + ② 突發處置 ({compareData.unexpectedList.length})
                        </div>
                      </div>
                      <div className="text-xl font-bold tabular-nums text-red-400">
                        {compareData.currDisposalCount} <span className="text-xs font-normal text-slate-400">支</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    {cards.map((card) => (
                      <button
                        key={card.key}
                        type="button"
                        aria-pressed={activeCompareCategory === card.key}
                        onClick={() => setActiveCompareCategory(card.key)}
                        className={`text-left p-3.5 rounded-xl border transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 ${
                          activeCompareCategory === card.key
                            ? card.activeClass
                            : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-white">{card.title}</span>
                          <span className={`text-xl font-bold tabular-nums ${card.countClass}`}>
                            {card.count} <span className="text-xs font-normal text-slate-400">支</span>
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">{card.subtitle}</div>
                        <div className="text-[11px] text-slate-300 mt-2 pt-2 border-t border-slate-800/80">
                          {card.detail}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <GitCompare className="text-indigo-400" size={18} aria-hidden="true" />
                      <h3 className="text-base font-semibold text-slate-100">
                        {activeCategoryMeta.title}（{activeCategoryMeta.subtitle}）
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {onApplyToVisual && (
                        <button
                          type="button"
                          onClick={() => {
                            const [sourceYearStr] = currentSelection.split('-');
                            const [pastYearStr] = pastCurrentSelection.split('-');
                            onApplyToVisual({
                              ids: activeCategoryItems.map(item => item.id),
                              sourceYear: Number(sourceYearStr),
                              baseYear: Number(pastYearStr),
                              mode: 'suggested',
                              origin: 'decision',
                            });
                          }}
                          disabled={activeCategoryItems.length === 0}
                          className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                          title="將此分類管束套用至動態視覺檢視畫布"
                        >
                          <Play size={14} /> 在視覺圖中檢視
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={exportCompareToExcel}
                        disabled={!hasGeneratedCompare}
                        className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                      >
                        <Download size={14} /> 比對結果下載
                      </button>
                      <div className="text-sm font-medium px-3 py-1 rounded-full bg-indigo-900/20 text-indigo-300">
                        共 {activeCategoryItems.length} 支
                      </div>
                    </div>
                  </div>

                  <div
                    tabIndex={0}
                    role="region"
                    aria-label={`${activeCategoryMeta.title}明細`}
                    className="overflow-x-auto max-h-[440px] overflow-y-auto custom-scrollbar focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
                  >
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-slate-900 shadow-sm z-10">
                        <tr className="bg-slate-800/50 border-y border-slate-800">
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">區域</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">行/Row</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">列/Col</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">管齡</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400 whitespace-nowrap">
                            前期深度 <span className="text-[11px] font-normal text-slate-500">{formatSelectionLabel(pastCurrentSelection)}</span>
                          </th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400 whitespace-nowrap">
                            本次深度 <span className="text-[11px] font-normal text-slate-500">{formatSelectionLabel(currentSelection)}</span>
                          </th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400 whitespace-nowrap">跨期變化</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">本次觸發條件 / 目前去向</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {activeCategoryItems.map((item) => {
                          const parts = item.id.split('-');
                          const diffStr = item.isPluggedNow
                            ? '-'
                            : `${item.cross_diff >= 0 ? '+' : ''}${item.cross_diff.toFixed(1)}%`;
                          return (
                            <tr key={item.id} className="hover:bg-slate-800/50">
                              <td className="py-3 px-4 text-sm font-bold text-blue-300">{parts[0]}</td>
                              <td className="py-3 px-4 text-sm font-medium text-white">{parts[1]}</td>
                              <td className="py-3 px-4 text-sm font-medium text-white">{parts[2]}</td>
                              <td className="py-3 px-4 text-sm text-slate-300">{item.TubeAge} 年</td>
                              <td className="py-3 px-4 text-sm font-medium text-amber-300">
                                {item.past_depth.toFixed(1)}%
                              </td>
                              <td className={`py-3 px-4 text-sm font-bold ${
                                item.isPluggedNow ? 'text-slate-400' : activeCategoryMeta.countClass
                              }`}>
                                {item.isPluggedNow ? '已塞管' : `${item.curr_depth.toFixed(1)}%`}
                              </td>
                              <td className={`py-3 px-4 text-sm font-bold ${
                                item.isPluggedNow
                                  ? 'text-slate-500'
                                  : item.cross_diff > 0
                                    ? 'text-amber-500'
                                    : 'text-emerald-400'
                              }`}>
                                {diffStr}
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-400 max-w-[240px]">
                                <ul className="list-disc pl-4 space-y-0.5">
                                  {item.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                                </ul>
                              </td>
                            </tr>
                          );
                        })}
                        {activeCategoryItems.length === 0 && (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-slate-500">
                              {hasGeneratedCompare
                                ? '此分類目前無符合管束。'
                                : '尚未執行預警追蹤比對，請點擊左側或上方「預警追蹤比對 / 重新比對」按鈕。'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>

          <div
            role="tabpanel"
            aria-labelledby="tab-finalDiff"
            hidden={activeResultTab !== 'finalDiff'}
          >
            {(() => {
              const [currYearStr] = currentSelection.split('-');
              const currYearNum = Number(currYearStr) || 0;
              const targetHasMaint = currYearNum > 0 && maintenanceYears.includes(currYearNum);

              if (!targetHasMaint) {
                return (
                  <div className="py-12 px-6 text-center bg-slate-950/50 border border-slate-800 border-dashed rounded-xl space-y-2">
                    <CheckCircle2 size={32} className="mx-auto text-slate-600" aria-hidden="true" />
                    <h3 className="text-base font-semibold text-slate-200">
                      {currYearNum} 年度尚未上傳「大修處置 (After)」資料
                    </h3>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      請先從上方「建議處置清單」匯出處置底稿 Excel，定案並由左側「資料匯入與匯出 → 上傳【大修處置】(After)」匯入後，系統即可自動比對差異並顯示於視覺圖。
                    </p>
                  </div>
                );
              }

              const cards = [
                {
                  key: 'matched' as const,
                  title: '① 依建議執行',
                  subtitle: '建議命中並實際換/塞管',
                  count: finalDiffData.matchedList.length,
                  detail: '公式建議與最終決策一致',
                  activeClass: 'border-emerald-500 bg-emerald-950/30',
                  countClass: 'text-emerald-400',
                },
                {
                  key: 'added' as const,
                  title: '② 決策額外新增',
                  subtitle: '未達建議門檻，現場追加',
                  count: finalDiffData.addedList.length,
                  detail: '視覺圖將以金色外框凸顯',
                  activeClass: 'border-amber-500 bg-amber-950/30',
                  countClass: 'text-amber-400',
                },
                {
                  key: 'kept' as const,
                  title: '③ 建議但最終保留',
                  subtitle: '公式建議處置但評估暫緩',
                  count: finalDiffData.keptList.length,
                  detail: '視覺圖將以虛線空心圈標示',
                  activeClass: 'border-slate-500 bg-slate-800/40',
                  countClass: 'text-slate-300',
                },
              ];

              const activeMeta = cards.find(c => c.key === activeFinalDiffCategory) || cards[0];
              const activeItems =
                activeFinalDiffCategory === 'matched'
                  ? finalDiffData.matchedList
                  : activeFinalDiffCategory === 'added'
                    ? finalDiffData.addedList
                    : finalDiffData.keptList;

              const [baseYearStr] = previousSelection.split('-');
              const baseYearNum = Number(baseYearStr) || null;
              const diffUnionIds = Array.from(new Set([...finalDiffData.suggestedIds, ...finalDiffData.finalIds]));

              return (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 border border-slate-800 rounded-lg p-3 mb-4">
                    <div className="text-xs text-slate-300">
                      比對基準：<span className="font-bold text-white">{currYearNum} 年大修檢測建議</span>
                      <span className="mx-2 text-slate-500">VS</span>
                      <span className="font-bold text-emerald-400">{currYearNum} 年大修處置 (After)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => runAnalysis('finalDiff')}
                      disabled={analyzing}
                      className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors"
                    >
                      {analyzing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      重新比對最終處置
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div className="flex items-center justify-between bg-red-950/20 border border-red-500/30 rounded-lg px-4 py-2.5">
                      <div>
                        <div className="text-xs font-semibold text-red-300">建議處置總數</div>
                        <div className="text-[11px] text-slate-400">
                          ① 依建議執行 ({finalDiffData.matchedList.length}) + ③ 建議但保留 ({finalDiffData.keptList.length})
                        </div>
                      </div>
                      <div className="text-xl font-bold tabular-nums text-red-400">
                        {finalDiffData.suggestedCount} <span className="text-xs font-normal text-slate-400">支</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-emerald-950/20 border border-emerald-500/30 rounded-lg px-4 py-2.5">
                      <div>
                        <div className="text-xs font-semibold text-emerald-300">最終大修處置總數 (After)</div>
                        <div className="text-[11px] text-slate-400">
                          換管 RPL {finalDiffData.rplCount} 支 · 塞管 PLG {finalDiffData.plgCount} 支
                        </div>
                      </div>
                      <div className="text-xl font-bold tabular-nums text-emerald-400">
                        {finalDiffData.finalCount} <span className="text-xs font-normal text-slate-400">支</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    {cards.map((card) => (
                      <button
                        key={card.key}
                        type="button"
                        aria-pressed={activeFinalDiffCategory === card.key}
                        onClick={() => setActiveFinalDiffCategory(card.key)}
                        className={`text-left p-3.5 rounded-xl border transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${
                          activeFinalDiffCategory === card.key
                            ? card.activeClass
                            : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-white">{card.title}</span>
                          <span className={`text-xl font-bold tabular-nums ${card.countClass}`}>
                            {card.key === 'added' && card.count > 0 ? `+${card.count}` : card.count}{' '}
                            <span className="text-xs font-normal text-slate-400">支</span>
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">{card.subtitle}</div>
                        <div className="text-[11px] text-slate-300 mt-2 pt-2 border-t border-slate-800/80">
                          {card.detail}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="text-emerald-400" size={18} aria-hidden="true" />
                      <h3 className="text-base font-semibold text-slate-100">
                        {activeMeta.title}（{activeMeta.subtitle}）
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {onApplyToVisual && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              onApplyToVisual({
                                ids: finalDiffData.finalIds,
                                suggestedIds: finalDiffData.suggestedIds,
                                finalIds: finalDiffData.finalIds,
                                sourceYear: currYearNum,
                                baseYear: baseYearNum,
                                mode: 'final',
                                enableDisposalColors: true,
                                origin: 'decision',
                              })
                            }
                            disabled={finalDiffData.finalIds.length === 0}
                            className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors font-semibold"
                            title="僅顯示最終大修處置 (After) 的管束並開啟處置顏色"
                          >
                            <Play size={14} /> 視覺圖檢視最終處置 ({finalDiffData.finalIds.length})
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onApplyToVisual({
                                ids: diffUnionIds,
                                suggestedIds: finalDiffData.suggestedIds,
                                finalIds: finalDiffData.finalIds,
                                sourceYear: currYearNum,
                                baseYear: baseYearNum,
                                mode: 'diff',
                                enableDisposalColors: true,
                                origin: 'decision',
                              })
                            }
                            disabled={diffUnionIds.length === 0}
                            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors font-semibold"
                            title="同時標示依建議執行、決策新增與建議保留的差異"
                          >
                            <GitCompare size={14} /> 視覺圖檢視差異
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={exportFinalDiffToExcel}
                        disabled={!hasGeneratedFinalDiff}
                        className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors"
                      >
                        <Download size={14} /> 差異比對下載
                      </button>
                      <div className="text-sm font-medium px-3 py-1 rounded-full bg-emerald-900/20 text-emerald-300">
                        共 {activeItems.length} 支
                      </div>
                    </div>
                  </div>

                  <div
                    tabIndex={0}
                    role="region"
                    aria-label={`${activeMeta.title}明細`}
                    className="overflow-x-auto max-h-[440px] overflow-y-auto custom-scrollbar focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
                  >
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-slate-900 shadow-sm z-10">
                        <tr className="bg-slate-800/50 border-y border-slate-800">
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">區域</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">行/Row</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">列/Col</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">管齡</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">本次深度</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400 whitespace-nowrap">深度差異</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">建議觸發條件</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400 whitespace-nowrap">最終處置 (After)</th>
                          <th scope="col" className="py-3 px-4 text-sm font-semibold text-slate-400">材質 / 備註</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {activeItems.map((item) => {
                          const parts = item.id.split('-');
                          const actionBadgeClass =
                            item.action === 'RPL'
                              ? 'bg-red-950/70 text-red-300 border-red-800'
                              : item.action === 'PLG'
                                ? 'bg-fuchsia-950/70 text-fuchsia-300 border-fuchsia-800'
                                : 'bg-slate-800 text-slate-300 border-slate-700';
                          return (
                            <tr key={item.id} className="hover:bg-slate-800/50">
                              <td className="py-3 px-4 text-sm font-bold text-blue-300">{parts[0]}</td>
                              <td className="py-3 px-4 text-sm font-medium text-white">{parts[1]}</td>
                              <td className="py-3 px-4 text-sm font-medium text-white">{parts[2]}</td>
                              <td className="py-3 px-4 text-sm text-slate-300">{item.TubeAge} 年</td>
                              <td className={`py-3 px-4 text-sm font-bold ${activeMeta.countClass}`}>
                                {item.this_depth.toFixed(1)}%
                              </td>
                              <td className="py-3 px-4 text-sm font-bold text-amber-500">
                                +{item.depth_Diff.toFixed(1)}%
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-400 max-w-[200px]">
                                <ul className="list-disc pl-4 space-y-0.5">
                                  {item.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                                </ul>
                              </td>
                              <td className="py-3 px-4 text-xs whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded border font-semibold ${actionBadgeClass}`}>
                                  {formatMaintActionLabel(item.action)}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-300 max-w-[200px]">
                                {item.new_material && <div className="text-yellow-200 font-medium">新材質: {item.new_material}</div>}
                                <div className="text-slate-400">{item.maintNotes || (item.new_material ? '' : '-')}</div>
                              </td>
                            </tr>
                          );
                        })}
                        {activeItems.length === 0 && (
                          <tr>
                            <td colSpan={9} className="py-8 text-center text-slate-500">
                              {hasGeneratedFinalDiff
                                ? '此分類目前無符合管束。'
                                : '點擊上方「重新比對最終處置」或左側「執行篩選」產生比對結果。'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
