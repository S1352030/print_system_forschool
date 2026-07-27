/**
 * 主應用模組(使用者端 index.html 用)
 * 負責:
 * 1. 對話框轉發(把全域 showAlert/showConfirm 暴露給其他 ES module 使用)
 * 2. Tab 切換(檔案上傳 / 歷史訂單)
 * 3. 主題切換(深/淺模式 + View Transitions)
 * 4. 公告載入(localStorage 快取 + SWR)
 * 5. Service Worker 註冊
 * 6. 離線偵測
 * 7. 把需要 inline onclick 的函式掛到 window
 */

import { bindUploadEvents, checkFormValidity, updatePriceSummary,
         updateFileSetting, updateFileOtherText, removeFile,
         changeActiveFile, previewFile, updateFitMode } from './upload.js';
import { bindPdfNavButtons, previewPastOrder } from './preview.js';
import { bindHistoryEvents, fetchHistory, invalidateHistoryCache } from './history.js';
import { apiGet, ApiError } from './api.js';
import { escHtml } from './utils.js';

// ── 對話框轉發 ────────────────────────────────────────────────
// dialog.js 把 showAlert / showConfirm 掛在 window 上(非模組)。
// 這裡把它們重新匯出,讓其他 ES module 可 import 使用。
export const showAlert = (msg, type, title) => window.showAlert(msg, type, title);
export const showConfirm = (msg, type, title) => window.showConfirm(msg, type, title);

// 給 upload.js 在上傳成功後呼叫,觸發歷史訂單更新
export { invalidateHistoryCache };
export function refreshHistory() {
  fetchHistory(false);
}

// ── Tab 切換(MD3 Fade Through)──────────────────────────────
function switchTab(tab) {
  const currentTab = document.querySelector('.md3-tab.active');
  if (!currentTab) return;
  const currentTabId = currentTab.id;
  if ((tab === 'upload' && currentTabId === 'tab-upload') ||
      (tab === 'history' && currentTabId === 'tab-history')) return;

  const apply = () => updateTabDOM(tab);

  if (!document.startViewTransition) { apply(); return; }
  document.documentElement.classList.add('tab-transition');   // 限定 Fade Through 動畫
  const transition = document.startViewTransition(apply);
  transition.finished.finally(() => document.documentElement.classList.remove('tab-transition'));
}
window.switchTab = switchTab;

function updateTabDOM(tab) {
  const tabUpload = document.getElementById('tab-upload');
  const tabHistory = document.getElementById('tab-history');
  const uploadPanel = document.getElementById('upload-panel');
  const historyPanel = document.getElementById('history-panel');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');

  if (tab === 'upload') {
    tabUpload.classList.add('active');
    tabHistory.classList.remove('active');
    uploadPanel.classList.remove('hidden');
    historyPanel.classList.add('hidden');
    pageTitle.textContent = '自助影印上傳';
    pageSubtitle.textContent = '請填寫資料並設定列印選項';
  } else {
    tabUpload.classList.remove('active');
    tabHistory.classList.add('active');
    uploadPanel.classList.add('hidden');
    historyPanel.classList.remove('hidden');
    pageTitle.textContent = '歷史訂單查詢';
    pageSubtitle.textContent = '輸入姓名/學號即可查看您的列印紀錄';

    const searchInput = document.getElementById('history_search_name');
    const listDiv = document.getElementById('history-list');
    if (searchInput.value.trim() && listDiv && listDiv.children.length === 0) {
      fetchHistory(true);
    }
  }
}

// ── 主題切換(MD3 Expressive 輻射揭示)──────────────────────────
function bindThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', (event) => {
    // 輻射原點:游標座標;event.detail === 0 為鍵盤 Enter/Space 合成 click,退回按鈕中心
    let x = event.clientX, y = event.clientY;
    if (event.detail === 0 || (!x && !y)) {
      const r = btn.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    // 到畫面最遠角的距離 = 圓形擴張終止半徑(已涵蓋行動版網址列伸縮的微小視口變化)
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );
    const root = document.documentElement;
    root.style.setProperty('--theme-transition-x', `${x}px`);
    root.style.setProperty('--theme-transition-y', `${y}px`);
    root.style.setProperty('--theme-transition-r', `${endRadius}px`);

    const apply = () => {
      const isDark = root.classList.toggle('dark');
      sessionStorage.setItem('theme', isDark ? 'dark' : 'light');
    };

    if (!document.startViewTransition) { apply(); return; }

    root.classList.add('theme-transition');           // 限定輻射動畫 + 防破窗
    const transition = document.startViewTransition(apply);
    transition.finished.finally(() => root.classList.remove('theme-transition'));
  });
}

// ── 公告載入(localStorage 快取 + SWR)─────────────────────────
const ANNOUNCE_CACHE_KEY = 'announcements_cache';
const ANNOUNCE_CACHE_TTL = 5 * 60 * 1000; // 5 分鐘

async function loadActiveAnnouncements() {
  const container = document.getElementById('announce-items-container');
  const card = document.getElementById('announce-card');
  if (!container || !card) return;

  // SWR:先讀 localStorage 快取立即渲染
  try {
    const cachedStr = localStorage.getItem(ANNOUNCE_CACHE_KEY);
    if (cachedStr) {
      const cached = JSON.parse(cachedStr);
      if (cached && Array.isArray(cached.items)) {
        renderAnnouncements(cached.items, container, card);
      }
    }
  } catch (e) {
    // 快取損壞,忽略
  }

  // 背景 revalidate
  try {
    const announcements = await apiGet('/api/announcements');
    const items = Array.isArray(announcements) ? announcements : [];
    renderAnnouncements(items, container, card);
    localStorage.setItem(
      ANNOUNCE_CACHE_KEY,
      JSON.stringify({ items, fetchedAt: Date.now() })
    );
  } catch (e) {
    // API 失敗時靠快取撐著,不報錯
    console.warn('無法載入公告:', e);
  }
}

function renderAnnouncements(items, container, card) {
  if (items && items.length > 0) {
    container.innerHTML = items
      .map((ann, idx) => {
        const divider = idx > 0 ? '<div class="announcement-item-divider"></div>' : '';
        return `${divider}<div class="announcement-item-text">${escHtml(ann.content)}</div>`;
      })
      .join('');
    card.classList.remove('hidden');
  } else {
    card.classList.add('hidden');
  }
}

// ── Service Worker 註冊 ──────────────────────────────────────
// 新版 SW（如 v8→v9）下載完成後，sw.js 的 skipWaiting() 會立即接管；
// 這裡監聽 controllerchange，在新 SW 接管的「那一刻」自動重載頁面，
// 讓既有訪客不必手動按 Ctrl+Shift+R 或清快取，就能吃到新版 JS。
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    // 防止新 SW 觸發多個 client 控制權變更時，導致無限 Reload 迴圈
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      console.log('[SW] Controller changed, reloading page for update...');
      window.location.reload();
    });

    // 註冊 SW 並維持原有的錯誤處理
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[SW] Registered correctly:', registration.scope);
      })
      .catch((error) => {
        console.error('[SW] Registration failed:', error);
      });
  }
}

// ── 離線狀態偵測 ──────────────────────────────────────────────
function updateOnlineStatus() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  if (!navigator.onLine) {
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ── 把 inline onclick 用到的函式掛到 window ───────────────────
// 這些函式在 HTML 中以 onclick="updateFileSetting(...)" 形式呼叫,
// ES module 預設是閉包,必須外掛到 window 才能被 inline 呼叫。
window.updateFileSetting = updateFileSetting;
window.updateFileOtherText = updateFileOtherText;
window.updateFitMode = updateFitMode;
window.removeFile = removeFile;
window.changeActiveFile = changeActiveFile;
window.previewFile = previewFile;
window.previewPastOrder = (orderId, fileName, fitMode) => {
  const searchName = (document.getElementById('history_search_name')?.value || '').trim()
    || sessionStorage.getItem('print_user_name');
  if (!searchName) {
    showAlert('請先輸入您的姓名或學號!', 'warning');
    return;
  }
  previewPastOrder(orderId, fileName, searchName, fitMode);
};

// ── 初始化 ────────────────────────────────────────────────────
export function initApp() {
  bindUploadEvents();
  bindPdfNavButtons();
  bindHistoryEvents();
  bindThemeToggle();
  registerServiceWorker();
  updateOnlineStatus();
  loadActiveAnnouncements();

  // 還原上次的使用者名稱
  const savedName = sessionStorage.getItem('print_user_name');
  if (savedName) {
    const userNameInput = document.getElementById('user_name');
    const historySearchInput = document.getElementById('history_search_name');
    if (userNameInput) userNameInput.value = savedName;
    if (historySearchInput) historySearchInput.value = savedName;
    checkFormValidity();
    updatePriceSummary();
  }
}
