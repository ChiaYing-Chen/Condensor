(function () {
  // 統一認證自訂 fetch
  const nativeFetch = window.fetch.bind(window);

  function customFetch(url, options = {}) {
    let targetUrl = url;
    if (currentUser && currentUser.userId && url.includes('/api/')) {
      const separator = url.includes('?') ? '&' : '?';
      if (!url.includes('clientUser=')) {
        targetUrl = `${url}${separator}clientUser=${encodeURIComponent(currentUser.userId)}`;
      }
    }
    return nativeFetch(targetUrl, {
      ...options,
      credentials: options.credentials || 'include'
    });
  }

  // ==========================================
  // 統一頁首組件腳本 (Unified Header Script)
  // Namespace: unified
  // ==========================================

  // SVG 圖示代碼庫 (避免依賴外部 Lucide 庫，加上明確的屬性以防止樣式污染)
  const SVG_ICONS = {
    launcher: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;"><rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor"/><rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor"/><rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor"/><rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor"/></svg>`,
    FileText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
    Activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
    Calculator: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>`,
    Droplets: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.09 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M17 18.5c1.37 0 2.5-1.14 2.5-2.53 0-.72-.35-1.41-1.07-2s-1.43-1.42-1.61-2.33c-.18.91-.71 1.77-1.43 2.35s-1.39 1.09-1.39 1.81c0 1.39 1.13 2.53 2.5 2.53z"/></svg>`,
    ClipboardList: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><rect width="16" height="18" x="4" y="4" rx="2"/><path d="M16 2H8v4h8z"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>`,
    Database: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`,
    Settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    Shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><path d="M20 13c0 5-3.5 7.5-7.66 9.7a1 1 0 0 1-.68 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 .76-.97l7-2a1 1 0 0 1 .48 0l7 2A1 1 0 0 1 20 6z"/></svg>`,
    LineChart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>`,
    Bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
    Edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    ChevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="m6 9 6 6 6-6"/></svg>`,
    Alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
    Link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`
  };

  // 64 位同仁工號對姓名對照表 (通訊錄)
  const USER_DIRECTORY = {
    '000472': '邱振能', '012226': '顏景智', '014767': '歐韋廷', '029059': '陳佳穎',
    '028656': '曾愷中', '006979': '李奇聰', '014999': '郭哲瑋', '034755': '陳宣佑',
    '008626': '林鉦淼', '047605': '賴景昌', '022894': '趙江浚', '018286': '王智鴻',
    '019358': '伍財宏', '030848': '林峻凱', '010412': '鄭祥哲', '014981': '蔡議鋒',
    '014973': '李敏雄', '036931': '張智盛', '036949': '陳鴻賓', '030781': '江茂印',
    '039429': '曾鴻濱', '042478': '劉俊佑', '012789': '蘇文功', '011831': '張韋傑',
    '018294': '鄭方瑋', '028698': '林俊辰', '035992': '賴啟文', '035380': '魏志賢',
    '010420': '林俊宏', '030799': '紀嘉瑋', '035372': '金維哲', '038993': '陳思齊',
    '042931': '張高瑋', '045403': '洪碩甫', '038985': '黃振翔', '046864': '蔡秉耕',
    '011295': '葉奇璋', '043251': '蕭倍芳', '010363': '陳忠性', '015029': '王義文',
    '034747': '王廣華', '024369': '吳泓達', '015988': '陳俊名', '018260': '蔡金成',
    '022852': '紀志良', '039007': '賴政佑', '034177': '蘇聖淵', '039560': '姜權哲',
    '019374': '郭維凱', '044951': '林宏嘉', '011328': '陳信榮', '050175': '朱育廷',
    '018252': '溫正宏', '043095': '吳永仁', '018278': '楊致豪', '011419': '郭哲源',
    '019366': '劉芳林', '037722': '葉金溪', '015003': '陳昭仁', '035710': '胡俊男',
    '034151': '楊泓興', '044969': '許家豪', '011427': '蔡英彥', '048892': '紀永豐'
  };

  // 全域變數狀態
  let currentUser = {
    userId: '',
    username: '匿名',
    isAuthenticated: false,
    source: 'LocalStorage',
    debug: {}
  };
  
  let appList = [];
  let userCustomLinks = [];
  let actualUserId = '';
  let anonymousLauncherMode = false;

  // 匿名嵌入入口只在跨網域 iframe 中啟用，避免一般 PIMCP 頁面繞過 Windows 驗證。
  function isEmbedLauncherEntry() {
    const path = (window.location.pathname || '').toLowerCase();
    return window.__PIMCP_EMBED_LAUNCHER === true || path.endsWith('/embed-launcher.html');
  }

  function isCrossOriginIframe() {
    if (window.self === window.top) return false;
    try {
      return window.top.location.origin !== window.location.origin;
    } catch (_error) {
      // 瀏覽器在跨網域 iframe 中禁止讀取 top.location，拋出例外即代表跨網域。
      return true;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getSafeAppUrl(value) {
    const url = String(value || '').trim();
    if (/^\/(?!\/)/.test(url)) return url;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : '#';
    } catch (_error) {
      return '#';
    }
  }

  function getSafeGradient(value) {
    const gradient = String(value || '').trim();
    return /^linear-gradient\([#a-zA-Z0-9(),.%\s-]+\)$/.test(gradient)
      ? gradient
      : 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)';
  }

  function getLauncherContextOrigin() {
    if (window.self === window.top) return window.location.origin;
    try {
      return window.top.location.origin;
    } catch (_error) {
      try {
        return document.referrer ? new URL(document.referrer).origin : null;
      } catch (_referrerError) {
        return null;
      }
    }
  }

  function shouldOpenAppInNewTab(value) {
    try {
      const targetOrigin = new URL(String(value || ''), window.location.href).origin;
      const contextOrigin = getLauncherContextOrigin();
      // 跨網域 iframe 若未提供 referrer，仍以不同網域處理，避免 APP 被困在 iframe 內。
      return contextOrigin ? targetOrigin !== contextOrigin : isCrossOriginIframe();
    } catch (_error) {
      return false;
    }
  }

  function getAppLinkTargetAttributes(value) {
    return shouldOpenAppInNewTab(value) ? ' target="_blank" rel="noopener noreferrer"' : '';
  }

  // 輔助函式：產生漸變色
  function getGradientStyle(name) {
    if (!name || name === '匿名') {
      return 'linear-gradient(135deg, #64748b 0%, #475569 100%)'; // 灰色
    }
    const colors = [
      ['#4f46e5', '#818cf8'], // 藍靛
      ['#0ea5e9', '#38bdf8'], // 天藍
      ['#10b981', '#34d399'], // 綠色
      ['#f59e0b', '#fbbf24'], // 橙黃
      ['#d946ef', '#f472b6'], // 洋紅
      ['#84cc16', '#a3e635'], // 萊姆綠
      ['#06b6d4', '#22d3ee']  // 青色
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return `linear-gradient(135deg, ${colors[index][0]} 0%, ${colors[index][1]} 100%)`;
  }

  // 輔助函式：取得名稱首字
  function getAvatarChar(name) {
    if (!name || name === '匿名') return '👻';
    // 取最後一個字或第一個英文字母
    const trimmed = name.trim();
    if (/^[A-Za-z]/.test(trimmed)) {
      return trimmed[0].toUpperCase();
    }
    return trimmed[trimmed.length - 1];
  }

  // 核心邏輯：探測 AD 身份
  async function probeIdentity() {
    const urls = [
      '/PIMCP/whoami.aspx',
      '/PIMCP/public/whoami.aspx',
      './whoami.aspx'
    ];

    for (let url of urls) {
      try {
        const res = await customFetch(`${url}?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.username && data.username !== '匿名') {
            const resolvedName = USER_DIRECTORY[data.username] || data.username;
            actualUserId = data.raw || data.username;
            currentUser = {
              userId: actualUserId,
              username: resolvedName,
              isAuthenticated: true,
              source: data.source || 'IIS NTLM',
              debug: data.debug || {}
            };
            // 同步寫入 LocalStorage，以相容各 App 內部原有邏輯
            localStorage.setItem('unified_user_name', resolvedName);
            localStorage.setItem('pages_manual_user', resolvedName);
            localStorage.setItem('appUserName', resolvedName);
            await loadServerIdentity();
            return;
          }
        }
      } catch (e) {
        // 繼續嘗試下一個 URL
      }
    }

    // 探測失敗，讀取 LocalStorage 緩存
    const savedName = localStorage.getItem('unified_user_name') || 
                      localStorage.getItem('pages_manual_user') || 
                      localStorage.getItem('appUserName');
    if (savedName && savedName !== '匿名') {
      const resolvedName = USER_DIRECTORY[savedName] || savedName;
      currentUser = {
        userId: savedName,
        username: resolvedName,
        isAuthenticated: false,
        source: 'LocalStorage 緩存',
        debug: { note: 'NTLM 探測失敗，載入先前手動設定' }
      };
    }
  }

  async function loadServerIdentity() {
    try {
      const res = await customFetch('/PIMCP/api/auth/whoami');
      const result = await res.json();
      if (!res.ok || !result.iisUser) return;

      actualUserId = result.actualUser || actualUserId;
      if (result.isImpersonating) {
        const switchedUserId = result.iisUser;
        const shortUserId = switchedUserId.split('\\').pop();
        currentUser = {
          userId: switchedUserId,
          username: USER_DIRECTORY[shortUserId] || shortUserId,
          isAuthenticated: true,
          source: `身分切換（原 ${actualUserId}）`,
          debug: currentUser.debug
        };
      }
    } catch (e) {
      console.warn('[Unified Header] 無法取得目前 API 身分', e);
    }
  }

  // 核心邏輯：載入 App 清單
  async function loadApps(options = {}) {
    try {
      const isAnonymous = options.anonymous === true;
      const endpoint = isAnonymous ? '/PIMCP/api/public/apps' : '/PIMCP/api/settings/apps';
      const res = await customFetch(endpoint, {
        cache: 'no-store',
        credentials: isAnonymous ? 'omit' : 'include'
      });
      const json = await res.json();
      if (!res.ok || !json.success || !Array.isArray(json.data)) {
        throw new Error(json.message || '系統 Apps API 回傳格式錯誤');
      }
      appList = json.data;
    } catch (e) {
      console.error('[Unified Header] PostgreSQL 系統 Apps 載入失敗', e);
      appList = [];
    }
  }

  // 核心邏輯：載入個人自訂捷徑 (PostgreSQL API)
  async function loadCustomLinks() {
    try {
      const res = await customFetch('/PIMCP/api/custom-links');
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          userCustomLinks = json.data;
        }
      }
    } catch (e) {
      console.warn('[Unified Header] 個人自訂捷徑載入失敗', e);
    }
  }

  // 頁首渲染與掛載
  function renderComponents() {
    // 1. 渲染 App Launcher (九宮格)
    const launcherContainer = document.getElementById('unified-app-launcher');
    if (launcherContainer) {
      launcherContainer.innerHTML = `
        <button class="unified-btn" id="unified-launcher-trigger" title="切換系統">
          ${SVG_ICONS.launcher}
        </button>
      `;
    }

    // 2. 渲染 User Profile Avatar (頭像)
    const avatarContainer = document.getElementById('unified-user-avatar');
    if (avatarContainer) {
      const char = getAvatarChar(currentUser.username);
      const gradient = getGradientStyle(currentUser.username);
      const authClass = currentUser.isAuthenticated ? 'active-auth' : '';
      
      avatarContainer.innerHTML = `
        <div class="unified-avatar-btn ${authClass}" id="unified-avatar-trigger" style="background: ${gradient}" title="目前使用者: ${currentUser.username}">
          ${char}
        </div>
      `;
    }

    // 重新繫結事件
    bindEvents();
  }

  // 動態渲染九宮格卡片內容
  function renderAppGrid(filterKeyword = '') {
    const gridContent = document.getElementById('unified-app-grid-content');
    const standaloneGridContent = document.getElementById('unified-standalone-grid-content');
    if (!gridContent && !standaloneGridContent) return;

    const kw = filterKeyword.trim().toLowerCase();

    // 1. 系統 App
    const filteredApps = kw ? appList.filter(app => (app.name && app.name.toLowerCase().includes(kw)) || (app.description && app.description.toLowerCase().includes(kw))) : appList;

    const systemCards = filteredApps.map(app => {
      let iconHtml = '';
      if (app.icon === 'FirstChar') {
        const firstChar = app.name ? app.name.trim().charAt(0).toUpperCase() : '';
        iconHtml = `<span class="unified-app-icon-char">${firstChar}</span>`;
      } else {
        iconHtml = SVG_ICONS[app.icon] || SVG_ICONS.FileText;
      }
      const safeUrl = getSafeAppUrl(app.url);
      const safeName = escapeHtml(app.name);
      const safeDescription = escapeHtml(app.description);
      const safeGradient = getSafeGradient(app.gradient);
      return `
        <a class="unified-app-card" href="${escapeHtml(safeUrl)}"${getAppLinkTargetAttributes(safeUrl)} title="開啟 ${safeName}">
          <div class="unified-app-icon-wrapper" style="background: ${safeGradient}; color: #ffffff">
            ${iconHtml}
          </div>
          <span class="unified-app-name">${safeName}</span>
          <span class="unified-app-desc">${safeDescription}</span>
        </a>
      `;
    }).join('');

    // 2. 個人自訂超連結
    const filteredCustom = kw ? userCustomLinks.filter(app => (app.name && app.name.toLowerCase().includes(kw)) || (app.description && app.description.toLowerCase().includes(kw))) : userCustomLinks;

    const customCards = filteredCustom.map(app => {
      const displayDesc = (app.description && app.description.length > 20) 
        ? app.description.slice(0, 19) + '…' 
        : (app.description || '');
      const safeUrl = getSafeAppUrl(app.url);
      return `
        <div class="unified-app-card-wrapper">
          <a class="unified-app-card" href="${escapeHtml(safeUrl)}"${getAppLinkTargetAttributes(safeUrl)} title="開啟 ${escapeHtml(app.name)}">
            <div class="unified-app-icon-wrapper" style="background: ${app.gradient}; color: #ffffff">
              ${SVG_ICONS.Link}
            </div>
            <span class="unified-app-name">${escapeHtml(app.name)}</span>
            <span class="unified-app-desc">${escapeHtml(displayDesc)}</span>
          </a>
          <button class="unified-app-edit-btn" data-id="${app.id}" title="編輯此捷徑">${SVG_ICONS.Edit}</button>
        </div>
      `;
    }).join('');

    // 3. 新增捷徑虛線卡片
    const addCard = anonymousLauncherMode ? '' : `
      <div class="unified-app-card unified-app-card-add" id="unified-add-custom-link-btn" title="新增自訂捷徑">
        <div class="unified-app-icon-wrapper-add">
          +
        </div>
        <span class="unified-app-name">新增捷徑</span>
        <span class="unified-app-desc">自訂九宮格連結</span>
      </div>
    `;

    const fullHtml = systemCards + customCards + addCard;

    if (gridContent) gridContent.innerHTML = fullHtml;
    if (standaloneGridContent) standaloneGridContent.innerHTML = fullHtml;
  }

  // 建立與掛載 Popovers (直接掛在 body 上，以避開父容器裁切)
  function createPopovers() {
    // 移除舊的 popovers 避免重複建立
    const oldLauncher = document.getElementById('unified-popover-launcher');
    if (oldLauncher) oldLauncher.remove();
    const oldUser = document.getElementById('unified-popover-user');
    if (oldUser) oldUser.remove();
    const oldCustomModal = document.getElementById('unified-modal-custom-app');
    if (oldCustomModal) oldCustomModal.remove();

    // A. App 啟動器彈窗 (標題改為 Apps)
    const launcherHtml = `
      <div class="unified-popover unified-launcher-popover" id="unified-popover-launcher">
        <div class="unified-popover-title">
          ${SVG_ICONS.launcher}
          <span>Apps</span>
        </div>
        <div class="unified-app-grid" id="unified-app-grid-content">
          <!-- 動態插入 App 卡片 -->
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', launcherHtml);

    // 渲染 App 卡片內容
    renderAppGrid();

    // B. 使用者資訊彈窗 (移除修改稱呼按鈕)
    const char = getAvatarChar(currentUser.username);
    const gradient = getGradientStyle(currentUser.username);
    const isImpersonating = currentUser.source.startsWith('身分切換');
    const authText = isImpersonating ? '模擬登入身分' : (currentUser.isAuthenticated ? 'Windows AD 驗證' : '本機設定');
    const sourceText = currentUser.source || 'LocalStorage';
    const identitySwitcherHtml = `
      <div class="unified-identity-switcher">
        <div class="unified-identity-switcher-title">切換登入身分</div>
        <input type="text" id="unified-identity-username" autocomplete="username" placeholder="AD 帳號，例如 029059">
        <input type="password" id="unified-identity-password" autocomplete="current-password" placeholder="AD 密碼">
        <div class="unified-identity-actions">
          ${isImpersonating ? '<button type="button" id="unified-identity-reset">恢復 AD 身分</button>' : '<span></span>'}
          <button type="button" class="primary" id="unified-identity-submit">驗證並切換</button>
        </div>
        <p id="unified-identity-message">密碼僅用於此次 AD 驗證，不會儲存。</p>
      </div>
    `;
    
    const userHtml = `
      <div class="unified-popover unified-user-popover" id="unified-popover-user">
        <div class="unified-user-info-box">
          <div class="unified-user-popover-avatar" style="background: ${gradient}">
            ${char}
          </div>
          <div class="unified-user-detail">
            <span class="unified-user-name">${currentUser.username}</span>
            <span class="unified-user-role">${authText}</span>
          </div>
        </div>
        <div class="unified-user-meta">
          <div class="unified-user-meta-item">
            <span>驗證來源</span>
            <span>${sourceText}</span>
          </div>
        </div>
        ${identitySwitcherHtml}
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', userHtml);

    // C. 註冊自訂超連結 Modal (高質感配色挑選器)
    const customModalHtml = `
      <div class="unified-modal-overlay" id="unified-modal-custom-app">
        <div class="unified-modal-box">
          <div class="unified-modal-title">🔗 新增自訂捷徑</div>
          <div class="unified-modal-desc">
            將您常用的系統或網頁新增到您的個人九宮格中。
          </div>
          <div style="margin-bottom:12px; text-align:left;">
            <label class="unified-modal-label" style="font-weight:600; font-size:12px; color:rgba(255,255,255,0.7);">捷徑名稱</label>
            <input type="text" class="unified-modal-input" id="unified-custom-app-name" placeholder="例如：維護系統" style="margin-top:6px; width:100%; box-sizing:border-box;">
          </div>
          <div style="margin-bottom:12px; text-align:left;">
            <label class="unified-modal-label" style="font-weight:600; font-size:12px; color:rgba(255,255,255,0.7);">網址 (URL)</label>
            <input type="text" class="unified-modal-input" id="unified-custom-app-url" placeholder="例如：http://localhost:3000" style="margin-top:6px; width:100%; box-sizing:border-box;">
          </div>
          <div style="margin-bottom:12px; text-align:left;">
            <label class="unified-modal-label" style="font-weight:600; font-size:12px; color:rgba(255,255,255,0.7);">捷徑描述 (限 20 字)</label>
            <input type="text" class="unified-modal-input" id="unified-custom-app-desc" placeholder="例如：開啟個人化中心" maxlength="20" style="margin-top:6px; width:100%; box-sizing:border-box;">
          </div>
          <div style="margin-bottom:20px; text-align:left;">
            <label class="unified-modal-label" style="font-weight:600; font-size:12px; color:rgba(255,255,255,0.7);">卡片漸層配色</label>
            <div class="unified-gradient-picker" id="unified-custom-app-gradient-picker" style="display:flex; gap:8px; margin-top:8px;">
              <div class="unified-gradient-option selected" data-gradient="linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)" style="background:linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); width:32px; height:32px; border-radius:50%; cursor:pointer; border:2px solid transparent; box-sizing:border-box;"></div>
              <div class="unified-gradient-option" data-gradient="linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)" style="background:linear-gradient(135deg, #a855f7 0%, #3b82f6 100%); width:32px; height:32px; border-radius:50%; cursor:pointer; border:2px solid transparent; box-sizing:border-box;"></div>
              <div class="unified-gradient-option" data-gradient="linear-gradient(135deg, #3b82f6 0%, #10b981 100%)" style="background:linear-gradient(135deg, #3b82f6 0%, #10b981 100%); width:32px; height:32px; border-radius:50%; cursor:pointer; border:2px solid transparent; box-sizing:border-box;"></div>
              <div class="unified-gradient-option" data-gradient="linear-gradient(135deg, #10b981 0%, #84cc16 100%)" style="background:linear-gradient(135deg, #10b981 0%, #84cc16 100%); width:32px; height:32px; border-radius:50%; cursor:pointer; border:2px solid transparent; box-sizing:border-box;"></div>
              <div class="unified-gradient-option" data-gradient="linear-gradient(135deg, #f97316 0%, #ef4444 100%)" style="background:linear-gradient(135deg, #f97316 0%, #ef4444 100%); width:32px; height:32px; border-radius:50%; cursor:pointer; border:2px solid transparent; box-sizing:border-box;"></div>
            </div>
          </div>
          <div class="unified-modal-actions" style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-top:20px; box-sizing:border-box;">
            <button class="unified-modal-btn unified-modal-btn-danger" id="unified-custom-app-delete" style="display:none;">刪除捷徑</button>
            <div style="display:flex; gap:8px; margin-left:auto;">
              <button class="unified-modal-btn" id="unified-custom-app-cancel">取消</button>
              <button class="unified-modal-btn unified-modal-btn-primary" id="unified-custom-app-save">儲存捷徑</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', customModalHtml);
  }

  // 事件繫結邏輯
  function bindEvents() {
    let currentEditingLinkId = null;
    const launcherTrigger = document.getElementById('unified-launcher-trigger');
    const avatarTrigger = document.getElementById('unified-avatar-trigger');
    const popoverLauncher = document.getElementById('unified-popover-launcher');
    const popoverUser = document.getElementById('unified-popover-user');
    
    // 自訂連結相關元素
    const customModal = document.getElementById('unified-modal-custom-app');
    const modalTitle = customModal ? customModal.querySelector('.unified-modal-title') : null;
    const customDeleteBtn = document.getElementById('unified-custom-app-delete');
    const addCustomBtn = document.getElementById('unified-add-custom-link-btn');
    const customNameInput = document.getElementById('unified-custom-app-name');
    const customUrlInput = document.getElementById('unified-custom-app-url');
    const gradientPicker = document.getElementById('unified-custom-app-gradient-picker');
    const customCancel = document.getElementById('unified-custom-app-cancel');
    const customSave = document.getElementById('unified-custom-app-save');
    const identityUsername = document.getElementById('unified-identity-username');
    const identityPassword = document.getElementById('unified-identity-password');
    const identitySubmit = document.getElementById('unified-identity-submit');
    const identityReset = document.getElementById('unified-identity-reset');
    const identityMessage = document.getElementById('unified-identity-message');

    function configureLauncherLayout(trigger, popover, margin, gap) {
      const isLauncher = popover.id === 'unified-popover-launcher';
      if (!isLauncher) return { isSidebarLauncher: false, expandRight: false };

      const rect = trigger.getBoundingClientRect();
      const grid = popover.querySelector('#unified-app-grid-content');
      const isSidebarLauncher = rect.left < 200;
      const availableLeft = Math.max(0, rect.right - margin);
      const availableRight = Math.max(0, window.innerWidth - rect.right - gap - margin);
      const expandRight = isSidebarLauncher || availableRight > availableLeft;
      const maxAvailableWidth = Math.max(220, expandRight ? availableRight : availableLeft);
      const gridGap = 12;
      const popoverPaddingX = 40;
      const minCardWidth = 112;

      popover.classList.toggle('sidebar-context', isSidebarLauncher);
      popover.style.setProperty('--unified-app-card-min', `${minCardWidth}px`);
      popover.style.maxHeight = `${Math.max(240, window.innerHeight - margin * 2)}px`;

      if (!grid || grid.children.length === 0) {
        popover.style.setProperty('--unified-app-columns', '3');
        popover.style.setProperty('--unified-launcher-width', `${Math.min(380, maxAvailableWidth)}px`);
        popover.style.overflowY = 'auto';
        return { isSidebarLauncher, expandRight };
      }

      popover.style.setProperty('--unified-app-columns', '3');
      popover.style.setProperty('--unified-launcher-width', `${Math.min(380, maxAvailableWidth)}px`);
      popover.style.overflowY = 'auto';

      const itemCount = grid.children.length;
      const fullGridHeight = grid.scrollHeight || 0;
      const fullPopoverHeight = popover.scrollHeight || 0;
      const otherHeight = Math.max(76, fullPopoverHeight - fullGridHeight);
      const maxGridHeight = Math.max(140, window.innerHeight - margin * 2 - otherHeight);
      const firstCard = grid.children[0];
      const cardHeight = Math.max(98, firstCard ? firstCard.getBoundingClientRect().height : 112);
      const maxRows = Math.max(1, Math.floor((maxGridHeight + gridGap) / (cardHeight + gridGap)));
      const requiredColumns = Math.ceil(itemCount / maxRows);
      const maxColumns = Math.max(1, Math.floor((maxAvailableWidth - popoverPaddingX + gridGap) / (minCardWidth + gridGap)));
      const baseColumns = Math.min(3, itemCount);
      const columns = Math.max(1, Math.min(itemCount, maxColumns, Math.max(baseColumns, requiredColumns)));
      const targetWidth = popoverPaddingX + columns * minCardWidth + Math.max(0, columns - 1) * gridGap;

      popover.style.setProperty('--unified-app-columns', String(columns));
      popover.style.setProperty('--unified-launcher-width', `${Math.min(targetWidth, maxAvailableWidth)}px`);
      popover.style.overflowY = columns >= requiredColumns ? 'visible' : 'auto';

      return { isSidebarLauncher, expandRight };
    }

    // 下拉定位函數 (具備上下與左右邊界防護)
    function positionPopover(trigger, popover) {
      if (!trigger || !popover) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 12;
      const gap = 8;
      
      const launcherLayout = configureLauncherLayout(trigger, popover, margin, gap);
      const isLauncher = popover.id === 'unified-popover-launcher';
      
      const measuredRect = popover.getBoundingClientRect();
      const popoverWidth = measuredRect.width || popover.offsetWidth || 300;
      const popoverHeight = measuredRect.height || popover.offsetHeight || 250;
      
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      let top;
      let left;
      
      if (isLauncher && launcherLayout.isSidebarLauncher) {
        top = rect.bottom - popoverHeight;
        left = rect.right + gap;
      } else if (spaceBelow < popoverHeight + gap + margin && spaceAbove > spaceBelow) {
        top = rect.top - popoverHeight - gap;
        left = isLauncher && launcherLayout.expandRight
          ? rect.right + gap
          : rect.left + rect.width - popoverWidth;
      } else {
        top = rect.bottom + gap;
        left = isLauncher && launcherLayout.expandRight
          ? rect.right + gap
          : rect.left + rect.width - popoverWidth;
      }
      
      const minTop = margin;
      const maxTop = window.innerHeight - popoverHeight - margin;
      const minLeft = margin;
      const maxLeft = window.innerWidth - popoverWidth - margin;

      top = Math.min(Math.max(top, minTop), Math.max(minTop, maxTop));
      left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));
      
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
    }

    // 點擊顯示 App Launcher Popover
    if (launcherTrigger && popoverLauncher) {
      launcherTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        popoverUser.classList.remove('show');
        popoverLauncher.classList.toggle('show');
        if (popoverLauncher.classList.contains('show')) {
          positionPopover(launcherTrigger, popoverLauncher);
        }
      });
    }

    // 點擊顯示 User Popover
    if (avatarTrigger && popoverUser) {
      avatarTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        popoverLauncher.classList.remove('show');
        popoverUser.classList.toggle('show');
        if (popoverUser.classList.contains('show')) {
          positionPopover(avatarTrigger, popoverUser);
        }
      });
    }

    if (identitySubmit && identityUsername && identityPassword) {
      identitySubmit.addEventListener('click', async function () {
        const username = identityUsername.value.trim();
        const password = identityPassword.value;
        if (!username || !password) {
          identityMessage.textContent = '請輸入 AD 帳號與密碼。';
          identityMessage.className = 'error';
          return;
        }

        identitySubmit.disabled = true;
        identityMessage.textContent = '正在驗證 AD 帳號...';
        identityMessage.className = '';
        try {
          const res = await customFetch('/PIMCP/api/auth/switch-identity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });
          const result = await res.json();
          identityPassword.value = '';
          if (!res.ok || !result.success) {
            identityMessage.textContent = result.message || 'AD 驗證失敗。';
            identityMessage.className = 'error';
            return;
          }
          window.location.reload();
        } catch (e) {
          identityPassword.value = '';
          identityMessage.textContent = '無法連線至 AD 驗證服務。';
          identityMessage.className = 'error';
        } finally {
          identitySubmit.disabled = false;
        }
      });
    }

    if (identityReset) {
      identityReset.addEventListener('click', async function () {
        identityReset.disabled = true;
        try {
          await customFetch('/PIMCP/api/auth/switch-identity', { method: 'DELETE' });
          window.location.reload();
        } finally {
          identityReset.disabled = false;
        }
      });
    }

    // 點擊「新增捷徑」卡片 (使用事件委派，避免 DOM 重繪後 click 失效)
    if (popoverLauncher && customModal) {
      popoverLauncher.addEventListener('click', function (e) {
        const addBtn = e.target.closest('#unified-add-custom-link-btn');
        if (!addBtn) return;
        e.stopPropagation();

        currentEditingLinkId = null;
        if (modalTitle) modalTitle.textContent = '🔗 新增自訂捷徑';
        if (customSave) customSave.textContent = '儲存捷徑';
        if (customDeleteBtn) customDeleteBtn.style.display = 'none';

        popoverLauncher.classList.remove('show');
        customModal.classList.add('show');
        if (customNameInput) {
          customNameInput.value = '';
          customUrlInput.value = '';
          const customDescInput = document.getElementById('unified-custom-app-desc');
          if (customDescInput) customDescInput.value = '';
          customNameInput.focus();
        }
      });
    }

    // 選擇漸層色
    if (gradientPicker) {
      gradientPicker.addEventListener('click', function (e) {
        const option = e.target.closest('.unified-gradient-option');
        if (!option) return;
        gradientPicker.querySelectorAll('.unified-gradient-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
      });
    }

    // 取消新增自訂捷徑
    if (customCancel && customModal) {
      customCancel.addEventListener('click', function () {
        customModal.classList.remove('show');
      });
    }

    // 儲存自訂捷徑
    const customDescInput = document.getElementById('unified-custom-app-desc');
    if (customSave && customModal && customNameInput && customUrlInput && customDescInput) {
      customSave.addEventListener('click', async function () {
        const name = customNameInput.value.trim();
        let url = customUrlInput.value.trim();
        const description = customDescInput.value.trim();
        
        if (!name || !url || !description) {
          alert('請填寫捷徑名稱、網址與描述！');
          return;
        }

        if (description.length > 20) {
          alert('描述不能超過 20 個字！');
          return;
        }

        // 自動補上協議頭 (如果沒有 HTTP/HTTPS)
        if (!/^https?:\/\//i.test(url) && !/^\//.test(url)) {
          url = 'http://' + url;
        }

        // 取得所選的漸層色
        const selectedOpt = gradientPicker ? gradientPicker.querySelector('.unified-gradient-option.selected') : null;
        const gradient = selectedOpt ? selectedOpt.getAttribute('data-gradient') : 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)';

        try {
          const isEdit = currentEditingLinkId !== null;
          const apiUrl = isEdit ? `/PIMCP/api/custom-links/${currentEditingLinkId}` : '/PIMCP/api/custom-links';
          const apiMethod = isEdit ? 'PUT' : 'POST';

          const res = await customFetch(apiUrl, {
            method: apiMethod,
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, url, description, gradient })
          });
          
          if (res.ok) {
            const json = await res.json();
            if (json.success) {
              customModal.classList.remove('show');
              // 重新載入自訂連結並更新卡片網格，不重新建立 Popover 以維持事件繫結
              await loadCustomLinks();
              renderAppGrid();
              // 重新展開啟動器
              if (popoverLauncher) {
                popoverLauncher.classList.add('show');
                positionPopover(launcherTrigger, popoverLauncher);
              }
            } else {
              alert('儲存失敗：' + json.message);
            }
          } else {
            alert('伺服器連線失敗！');
          }
        } catch (err) {
          console.error('新增自訂連結出錯:', err);
          alert('新增自訂連結出錯，請稍後再試。');
        }
      });
    }

    // 點擊「編輯」按鈕 (使用事件委派)
    if (popoverLauncher && customModal) {
      popoverLauncher.addEventListener('click', function (e) {
        const editBtn = e.target.closest('.unified-app-edit-btn');
        if (!editBtn) return;
        
        e.preventDefault();
        e.stopPropagation();

        const id = parseInt(editBtn.getAttribute('data-id'), 10);
        if (isNaN(id)) return;

        const app = userCustomLinks.find(x => x.id === id);
        if (!app) return;

        currentEditingLinkId = id;
        if (modalTitle) modalTitle.textContent = '✏️ 編輯自訂捷徑';
        if (customSave) customSave.textContent = '儲存變更';
        if (customDeleteBtn) customDeleteBtn.style.display = 'block';

        popoverLauncher.classList.remove('show');
        customModal.classList.add('show');

        if (customNameInput) customNameInput.value = app.name || '';
        if (customUrlInput) customUrlInput.value = app.url || '';
        const customDescInput = document.getElementById('unified-custom-app-desc');
        if (customDescInput) customDescInput.value = app.description || '';

        // 選取漸層色
        if (gradientPicker) {
          gradientPicker.querySelectorAll('.unified-gradient-option').forEach(opt => {
            if (opt.getAttribute('data-gradient') === app.gradient) {
              opt.classList.add('selected');
            } else {
              opt.classList.remove('selected');
            }
          });
        }
        if (customNameInput) customNameInput.focus();
      });
    }

    // 在 Modal 中點擊刪除捷徑
    if (customDeleteBtn && customModal) {
      customDeleteBtn.addEventListener('click', async function () {
        if (!currentEditingLinkId) return;
        if (!confirm('確定要刪除此自訂捷徑卡片嗎？')) {
          return;
        }

        try {
          const res = await customFetch(`/PIMCP/api/custom-links/${currentEditingLinkId}`, {
            method: 'DELETE'
          });

          if (res.ok) {
            const json = await res.json();
            if (json.success) {
              customModal.classList.remove('show');
              // 重新載入自訂連結並更新卡片網格，不重新建立 Popover 以維持事件繫結
              await loadCustomLinks();
              renderAppGrid();
              // 重新展開啟動器並定位
              if (popoverLauncher) {
                popoverLauncher.classList.add('show');
                positionPopover(launcherTrigger, popoverLauncher);
              }
            } else {
              alert('刪除失敗：' + json.message);
            }
          } else {
            alert('伺服器連線失敗！');
          }
        } catch (err) {
          console.error('刪除自訂捷徑出錯:', err);
          alert('刪除自訂捷徑出錯，請稍後再試。');
        }
      });
    }

    // 點擊外部關閉彈窗
    document.addEventListener('click', function (e) {
      const target = e.target;
      if (popoverLauncher && !popoverLauncher.contains(target) && target !== launcherTrigger && !target.closest('.unified-modal-overlay')) {
        popoverLauncher.classList.remove('show');
      }
      if (popoverUser && !popoverUser.contains(target) && target !== avatarTrigger) {
        popoverUser.classList.remove('show');
      }
    });

    // 視窗滾動或縮放時重新調整 Popovers 位置
    window.addEventListener('resize', function () {
      if (popoverLauncher && popoverLauncher.classList.contains('show')) {
        positionPopover(launcherTrigger, popoverLauncher);
      }
      if (popoverUser && popoverUser.classList.contains('show')) {
        positionPopover(avatarTrigger, popoverUser);
      }
    });

    // 監聽系統 Apps 清單更新事件，重新由 PostgreSQL API 載入。
    window.addEventListener('unified-apps-updated', async function () {
      try {
        await loadApps();
        renderAppGrid();
      } catch (err) {
        console.warn('[Unified Header] 同步刷新系統 Apps 清單失敗:', err);
      }
    });
  }

  // 監聽 DOM 變動，支援 React 等 SPA 框架的非同步動態渲染
  function startObserver() {
    if (typeof MutationObserver === 'undefined') return;

    const observer = new MutationObserver(function () {
      const launcher = document.getElementById('unified-app-launcher');
      const avatar = document.getElementById('unified-user-avatar');
      
      const needsLauncher = launcher && !launcher.querySelector('#unified-launcher-trigger');
      const needsAvatar = avatar && !avatar.querySelector('#unified-avatar-trigger');

      if (needsLauncher || needsAvatar) {
        renderComponents();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // 滿版獨立九宮格模式 (Option B for SharePoint iframe)
  function createStandaloneLauncher() {
    const params = new URLSearchParams(window.location.search);
    const mode = (params.get('mode') || '').toLowerCase();
    const launcherParam = (params.get('launcher') || '').toLowerCase();
    const hash = (window.location.hash || '').toLowerCase();

    const isLauncherOnly = anonymousLauncherMode || mode === 'launcher_only' || mode === 'launcher' || mode === 'grid' || launcherParam === '1' || launcherParam === 'only' || hash === '#apps';
    const shouldOpenPopover = launcherParam === 'open' || hash === '#launcher';

    if (isLauncherOnly) {
      document.body.classList.add('mode-launcher-only');

      let container = document.getElementById('unified-standalone-launcher');
      if (!container) {
        container = document.createElement('div');
        container.id = 'unified-standalone-launcher';
        container.className = 'unified-standalone-launcher';
        container.innerHTML = `
          <div class="unified-standalone-header">
            <div class="unified-standalone-title">
              ${SVG_ICONS.launcher}
              <span>Apps 系統啟動器</span>
            </div>
            <div class="unified-standalone-actions">
              <div class="unified-standalone-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input type="text" id="unified-standalone-search-input" placeholder="搜尋 Apps 或捷徑..." autocomplete="off">
              </div>
              ${anonymousLauncherMode ? '' : '<div class="unified-standalone-user" id="unified-standalone-user-badge"></div>'}
            </div>
          </div>
          <div class="unified-standalone-grid" id="unified-standalone-grid-content"></div>
        `;
        document.body.appendChild(container);

        // 搜尋事件
        const searchInput = document.getElementById('unified-standalone-search-input');
        if (searchInput) {
          if (anonymousLauncherMode) searchInput.placeholder = '搜尋 Apps...';
          searchInput.addEventListener('input', function (e) {
            renderAppGrid(e.target.value);
          });
        }

        // 繫結點擊「新增捷徑」與「編輯」事件 (事件委派)
        container.addEventListener('click', function (e) {
          const customModal = document.getElementById('unified-modal-custom-app');
          const addBtn = e.target.closest('#unified-add-custom-link-btn');
          if (addBtn && customModal) {
            e.stopPropagation();
            currentEditingLinkId = null;
            const modalTitle = customModal.querySelector('.unified-modal-title');
            const customSave = document.getElementById('unified-custom-app-save');
            const customDeleteBtn = document.getElementById('unified-custom-app-delete');
            const customNameInput = document.getElementById('unified-custom-app-name');
            const customUrlInput = document.getElementById('unified-custom-app-url');
            const customDescInput = document.getElementById('unified-custom-app-desc');

            if (modalTitle) modalTitle.textContent = '🔗 新增自訂捷徑';
            if (customSave) customSave.textContent = '儲存捷徑';
            if (customDeleteBtn) customDeleteBtn.style.display = 'none';

            customModal.classList.add('show');
            if (customNameInput) {
              customNameInput.value = '';
              customUrlInput.value = '';
              if (customDescInput) customDescInput.value = '';
              customNameInput.focus();
            }
            return;
          }

          const editBtn = e.target.closest('.unified-app-edit-btn');
          if (editBtn && customModal) {
            e.preventDefault();
            e.stopPropagation();
            const id = parseInt(editBtn.getAttribute('data-id'), 10);
            if (isNaN(id)) return;
            const app = userCustomLinks.find(x => x.id === id);
            if (!app) return;

            currentEditingLinkId = id;
            const modalTitle = customModal.querySelector('.unified-modal-title');
            const customSave = document.getElementById('unified-custom-app-save');
            const customDeleteBtn = document.getElementById('unified-custom-app-delete');
            const customNameInput = document.getElementById('unified-custom-app-name');
            const customUrlInput = document.getElementById('unified-custom-app-url');
            const customDescInput = document.getElementById('unified-custom-app-desc');

            if (modalTitle) modalTitle.textContent = '✏️ 編輯自訂捷徑';
            if (customSave) customSave.textContent = '更新捷徑';
            if (customDeleteBtn) customDeleteBtn.style.display = 'inline-flex';

            if (customNameInput) customNameInput.value = app.name || '';
            if (customUrlInput) customUrlInput.value = app.url || '';
            if (customDescInput) customDescInput.value = app.description || '';

            customModal.classList.add('show');
          }
        });
      }

      // 更新使用者資訊標籤
      const userBadge = document.getElementById('unified-standalone-user-badge');
      if (userBadge) {
        const char = getAvatarChar(currentUser.username);
        const gradient = getGradientStyle(currentUser.username);
        userBadge.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: rgba(255,255,255,0.85); font-weight: 500;">
            <div style="width: 28px; height: 28px; border-radius: 50%; background: ${gradient}; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; font-size: 12px;">${char}</div>
            <span>${escapeHtml(currentUser.username)}</span>
          </div>
        `;
      }

      // 重新渲染獨立九宮格網格
      renderAppGrid();
    } else if (shouldOpenPopover) {
      setTimeout(() => {
        const launcherTrigger = document.getElementById('unified-launcher-trigger');
        const popoverLauncher = document.getElementById('unified-popover-launcher');
        if (launcherTrigger && popoverLauncher) {
          popoverLauncher.classList.add('show');
          positionPopover(launcherTrigger, popoverLauncher);
        }
      }, 200);
    }
  }

  // 初始化流程
  async function init() {
    if (isEmbedLauncherEntry()) {
      if (!isCrossOriginIframe()) {
        window.location.replace('/PIMCP/');
        return;
      }

      anonymousLauncherMode = true;
      await loadApps({ anonymous: true });
      createStandaloneLauncher();
      return;
    }

    // 1. 先探測身分，再載入使用者相關內容
    await probeIdentity();
    await Promise.all([loadApps(), loadCustomLinks()]);

    // 2. 建立掛載在 body 的 Popovers
    createPopovers();

    // 3. 啟動觀察器，動態處理 SPA 的掛載
    startObserver();

    // 4. 初次嘗試渲染與掛載按鈕
    renderComponents();

    // 5. 檢測獨立九宮格模式 (Option B) 或自動展開參數
    createStandaloneLauncher();

    window.dispatchEvent(new CustomEvent('unified-user-changed', {
      detail: {
        userId: currentUser.userId,
        username: currentUser.username,
        isImpersonating: currentUser.source.startsWith('身分切換')
      }
    }));
  }

  // 確保 DOM 準備就緒後執行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
