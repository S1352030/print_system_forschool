/**
 * 歷史訂單模組(使用者端 index.html 用)
 * 負責查詢、快取(Stale-While-Revalidate)、渲染歷史訂單。
 *
 * M3 對齊 M2 分頁 API:採用「載入更多」模式,首次載 50 筆,
 * 使用者可點按鈕載入下一頁。
 */

import { showAlert } from './app.js';
import { previewPastOrder } from './preview.js';
import { apiGet, ApiError } from './api.js';
import { escHtml, escJsString, formatDate } from './utils.js';

const CACHE_TTL_MS = 30000; // 30 秒內不重複發送背景請求
const PAGE_SIZE = 50;

let _historyFetchTime = 0;
let _lastFetchedName = '';
// 分頁狀態
let _currentPage = 0;       // 0 = 尚未載入
let _totalPages = 0;
let _totalCount = 0;
let _accumulatedOrders = []; // 累積載入的訂單

export function invalidateHistoryCache() {
  _historyFetchTime = 0;
  _currentPage = 0;
  _totalPages = 0;
  _totalCount = 0;
  _accumulatedOrders = [];
}

/**
 * 查詢歷史訂單。
 * @param {boolean} forceRefresh 忽略快取強制重新查詢(重設為第 1 頁)
 */
export async function fetchHistory(forceRefresh = false) {
  const searchName = document.getElementById('history_search_name').value.trim();
  if (!searchName) {
    await showAlert('請輸入您的姓名或學號以供查詢!', 'warning');
    return;
  }

  sessionStorage.setItem('print_user_name', searchName);
  const userNameInput = document.getElementById('user_name');
  if (userNameInput) userNameInput.value = searchName;
  // 觸發表單驗證(透過 event 讓 upload 模組知道)
  userNameInput.dispatchEvent(new Event('input'));

  const loadingDiv = document.getElementById('history-loading');
  const emptyDiv = document.getElementById('history-empty');
  const listDiv = document.getElementById('history-list');

  // SWR:先嘗試讀 sessionStorage 快取立即渲染
  const cacheKey = `history_cache_${searchName}`;
  const cachedDataStr = sessionStorage.getItem(cacheKey);
  let hasRenderedCache = false;

  if (cachedDataStr && !forceRefresh) {
    try {
      const cached = JSON.parse(cachedDataStr);
      _accumulatedOrders = cached.orders || [];
      _currentPage = cached.currentPage || 0;
      _totalPages = cached.totalPages || 0;
      _totalCount = cached.totalCount || 0;
      emptyDiv.classList.add('hidden');
      loadingDiv.classList.add('hidden');
      listDiv.innerHTML = '';
      if (_accumulatedOrders.length === 0) {
        listDiv.classList.add('hidden');
        emptyDiv.classList.remove('hidden');
      } else {
        renderHistoryList(_accumulatedOrders);
        listDiv.classList.remove('hidden');
      }
      updateLoadMoreButton();
      hasRenderedCache = true;
    } catch (e) {
      console.warn('解析歷史訂單快取失敗', e);
    }
  }

  // 30 秒內且同姓名且非強制更新 → 不重新查詢
  if (!forceRefresh && _lastFetchedName === searchName && Date.now() - _historyFetchTime < CACHE_TTL_MS) {
    return;
  }

  // 重設分頁(每次新查詢從第 1 頁開始)
  if (forceRefresh || _lastFetchedName !== searchName) {
    _accumulatedOrders = [];
    _currentPage = 0;
  }

  if (!hasRenderedCache) {
    loadingDiv.classList.remove('hidden');
    emptyDiv.classList.add('hidden');
    listDiv.classList.add('hidden');
    listDiv.innerHTML = '';
  }

  try {
    const targetPage = (_currentPage || 0) + 1;
    const data = await apiGet(
      `/api/orders/history?user_name=${encodeURIComponent(searchName)}&page=${targetPage}&page_size=${PAGE_SIZE}`
    );

    _lastFetchedName = searchName;
    _historyFetchTime = Date.now();
    _currentPage = data.page;
    _totalPages = data.total_pages;
    _totalCount = data.total;

    // 累積訂單(避免重複)
    const existingIds = new Set(_accumulatedOrders.map((o) => o.id));
    for (const o of data.items) {
      if (!existingIds.has(o.id)) {
        _accumulatedOrders.push(o);
        existingIds.add(o.id);
      }
    }

    // 寫入 sessionStorage 快取
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({
        orders: _accumulatedOrders,
        currentPage: _currentPage,
        totalPages: _totalPages,
        totalCount: _totalCount,
      })
    );

    loadingDiv.classList.add('hidden');
    if (_accumulatedOrders.length === 0) {
      listDiv.classList.add('hidden');
      emptyDiv.classList.remove('hidden');
    } else {
      renderHistoryList(_accumulatedOrders);
      listDiv.classList.remove('hidden');
      emptyDiv.classList.add('hidden');
    }
    updateLoadMoreButton();
  } catch (error) {
    loadingDiv.classList.add('hidden');
    const msg = error instanceof ApiError ? error.message : error.message;
    await showAlert('查詢失敗:' + msg, 'error');
  }
}

/**
 * 載入下一頁。
 */
export async function loadMoreHistory() {
  await fetchHistory(false);
}

/**
 * 更新「載入更多」按鈕顯示狀態。
 */
function updateLoadMoreButton() {
  let btn = document.getElementById('history-load-more-btn');
  if (!btn) {
    // 動態建立按鈕(若 HTML 沒有)
    const listDiv = document.getElementById('history-list');
    if (!listDiv) return;
    btn = document.createElement('button');
    btn.id = 'history-load-more-btn';
    btn.className = 'load-more-btn';
    btn.textContent = '載入更多';
    btn.addEventListener('click', loadMoreHistory);
    listDiv.after(btn);
  }
  const hasMore = _currentPage < _totalPages;
  btn.classList.toggle('hidden', !hasMore);
  btn.textContent = `載入更多(還剩 ${Math.max(0, _totalCount - _accumulatedOrders.length)} 筆)`;
}

/**
 * 渲染歷史訂單列表。
 */
function renderHistoryList(orders) {
  const listDiv = document.getElementById('history-list');
  if (!listDiv) return;
  listDiv.innerHTML = orders
    .map((order) => {
      const paidBadge = order.is_paid
        ? '<span class="status-badge status-paid">🟢 已付款</span>'
        : '<span class="status-badge status-unpaid">🔴 未付款</span>';
      const printedBadge = order.is_printed
        ? '<span class="status-badge status-printed">🟢 已列印</span>'
        : '<span class="status-badge status-queued">🟡 排隊中</span>';

      const settingsBadges = [];
      settingsBadges.push(
        order.color_mode === 'color'
          ? '<span class="hist-badge hist-badge-color">彩色</span>'
          : '<span class="hist-badge hist-badge-bw">黑白</span>'
      );
      settingsBadges.push(
        order.duplex === 'double'
          ? '<span class="hist-badge hist-badge-double">雙面</span>'
          : '<span class="hist-badge hist-badge-single">單面</span>'
      );
      settingsBadges.push(
        order.fit_mode === 'cover'
          ? '<span class="hist-badge hist-badge-binding">裁切</span>'
          : '<span class="hist-badge hist-badge-binding">留白</span>'
      );
      if (order.binding === 'top_left') {
        settingsBadges.push('<span class="hist-badge hist-badge-binding">左上裝訂</span>');
      } else if (order.binding === 'top_right') {
        settingsBadges.push('<span class="hist-badge hist-badge-binding">右上裝訂</span>');
      } else if (order.binding === 'other') {
        settingsBadges.push('<span class="hist-badge hist-badge-binding">其他裝訂</span>');
      } else if (order.binding) {
        settingsBadges.push('<span class="hist-badge hist-badge-binding">' + escHtml(order.binding) + '</span>');
      }

      return `
        <div class="history-item">
          <div class="history-item-header">
            <span class="history-item-id">訂單編號 #${order.id}</span>
            <span class="history-item-date">${formatDate(order.created_at)}</span>
          </div>
          <div class="history-item-filename" onclick="previewPastOrder(${order.id}, '${escJsString(order.file_name)}', '${order.fit_mode || 'fit'}')" title="點擊預覽此檔案">
            <span class="material-symbols-outlined"><svg><use href="#i-picture_as_pdf"/></svg></span>
            <span>${escHtml(order.file_name)}</span>
          </div>
          <div class="history-item-badges">
            ${settingsBadges.join('')}
            <span class="hist-badge hist-badge-pages">${order.total_pages} 頁</span>
          </div>
          <div class="history-item-details">
            <div class="history-item-price">NT$ ${(order.total_price || 0).toLocaleString()} 元</div>
            <div class="history-item-badge-row">
              ${paidBadge}
              ${printedBadge}
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * 綁定歷史訂單搜尋按鈕事件。
 */
export function bindHistoryEvents() {
  const searchBtn = document.getElementById('history-search-btn');
  const searchInput = document.getElementById('history_search_name');
  if (searchBtn) searchBtn.addEventListener('click', () => fetchHistory(true));
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        fetchHistory(true);
      }
    });
  }
}
