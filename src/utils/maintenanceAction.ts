export type NormalizedMaintAction = 'RPL' | 'PLG' | 'KEP' | 'OTHER';

/** 將後端或 Excel 匯入的大修處置代碼正規化為標準代碼 */
export function normalizeMaintAction(rawAction?: string | null): NormalizedMaintAction {
  const act = String(rawAction || '').trim().toUpperCase();
  if (act === 'RPL' || act === '換管') return 'RPL';
  if (act === 'PLG' || act === '塞管') return 'PLG';
  if (act === 'KEP' || act === '保留') return 'KEP';
  return 'OTHER';
}

/** 判斷是否為實際處置動作（換管或塞管，排除 KEP 純備註保留管） */
export function isDisposalAction(rawAction?: string | null): boolean {
  const norm = normalizeMaintAction(rawAction);
  return norm === 'RPL' || norm === 'PLG';
}

/** 顯示用中文處置標籤 */
export function formatMaintActionLabel(rawAction?: string | null): string {
  const norm = normalizeMaintAction(rawAction);
  if (norm === 'RPL') return 'RPL 換管';
  if (norm === 'PLG') return 'PLG 塞管';
  if (norm === 'KEP') return 'KEP 保留';
  return String(rawAction || '保留').trim() || '保留';
}
