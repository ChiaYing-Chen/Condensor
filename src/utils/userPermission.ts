export interface CurrentUserPermissionInfo {
  userId: string;
  userName: string;
  isAdmin: boolean;
}

/**
 * 依序從 PIMCP whoami、localStorage 與 Condensor 權限 API 解析目前使用者的管理員權限。
 */
export async function fetchCurrentUserPermission(candidateUser?: string): Promise<CurrentUserPermissionInfo> {
  let identifier = String(candidateUser || '').trim();

  if (!identifier) {
    try {
      const whoamiRes = await fetch('/PIMCP/api/auth/whoami', { credentials: 'include' });
      if (whoamiRes.ok) {
        const whoamiData = await whoamiRes.json();
        const iisUser = String(whoamiData?.iisUser || '').trim();
        if (iisUser && iisUser.toLowerCase() !== 'guest') {
          identifier = iisUser;
        }
      }
    } catch {
      // 略過，繼續嘗試其他身分探測
    }
  }

  if (!identifier) {
    try {
      const aspxRes = await fetch(`/PIMCP/whoami.aspx?t=${Date.now()}`, { credentials: 'include' });
      if (aspxRes.ok) {
        const aspxData = await aspxRes.json();
        const rawName = String(aspxData?.raw || aspxData?.username || '').trim();
        if (rawName && rawName !== '匿名') {
          identifier = rawName;
        }
      }
    } catch {
      // 略過
    }
  }

  if (!identifier) {
    const cached =
      localStorage.getItem('unified_user_name') ||
      localStorage.getItem('pages_manual_user') ||
      localStorage.getItem('appUserName') ||
      '';
    if (cached && cached !== '匿名') {
      identifier = cached;
    }
  }

  if (!identifier) {
    return { userId: '', userName: '訪客', isAdmin: false };
  }

  try {
    const permRes = await fetch(
      `${import.meta.env.BASE_URL}api/permissions/check?user=${encodeURIComponent(identifier)}`
    );
    if (permRes.ok) {
      const permData = await permRes.json();
      return {
        userId: permData.userId || identifier,
        userName: permData.userName || identifier,
        isAdmin: Boolean(permData.isAdmin),
      };
    }
  } catch {
    // 嘗試透過 PIMCP API 確認權限
  }

  const shortId = identifier.split('\\').pop()?.trim() || identifier;
  try {
    const pimcpPermRes = await fetch(`/PIMCP/api/app-permissions/condensor/${encodeURIComponent(shortId)}`, {
      credentials: 'include',
    });
    if (pimcpPermRes.ok) {
      const pimcpData = await pimcpPermRes.json();
      return {
        userId: shortId,
        userName: identifier,
        isAdmin: Boolean(pimcpData?.data?.isAdmin),
      };
    }
  } catch {
    // 無法取得授權狀態時維持一般使用者權限
  }

  return { userId: shortId, userName: identifier, isAdmin: false };
}
