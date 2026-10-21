/**
 * 後台訂單管理模組(admin.html 用)
 * 對齊 M2.2 分頁 API:首次載 50 筆,提供「載入更多」。
 */

import { apiGet, apiPut, apiDelete, ApiError } from '../api.js';
import { escHtml, formatDate } from '../utils.js';
import { showConfirm } from '../dialog-api.js';

const API_BASE = '';
const PAGE_SIZE = 50;

let _allOrders = [];
let _currentPage = 0;
let _totalPages = 0;
let _totalCount = 0;
let _summary = null;
let _search = '';
let _loadRevision = 0;

/** 設定搜尋字串(姓名或訂單編號)並從第一頁重新載入。 */
export function searchOrders(query) {
  const next = String(query ?? '').trim();
  if (next === _search) return;
  _search = next;
  void loadOrders();
}

/**
 * 載入訂單(首次或載入更多)。
 * @param {boolean} loadMore true=載下一頁;false=重頭開始
 */
export async function loadOrders(loadMore = false) {
  const tbody = document.getElementById('order-tbody');
  const revision = ++_loadRevision;
  if (!loadMore) {
    _allOrders = [];
    _currentPage = 0;
    tbody.innerHTML = '<tr class="state-row"><td colspan="9"><span class="spinner"></span>載入訂單中…</td></tr>';
  }

  try {
    const targetPage = (_currentPage || 0) + 1;
    const query = _search ? `&q=${encodeURIComponent(_search)}` : '';
    const data = await apiGet(`${API_BASE}/api/orders?page=${targetPage}&page_size=${PAGE_SIZE}${query}`);
    // 較新的搜尋已送出時,忽略過期回應。
    if (revision !== _loadRevision) return;
    _currentPage = data.page;
    _totalPages = data.total_pages;
    _totalCount = data.total;
    _summary = data.summary || null;

    // 累積訂單(去重)
    const existingIds = new Set(_allOrders.map((o) => o.id));
    for (const o of data.items) {
      if (!existingIds.has(o.id)) {
        _allOrders.push(o);
        existingIds.add(o.id);
      }
    }

    renderTable(_allOrders);
    renderStats(_allOrders);
    updateLoadMoreButton();
  } catch (error) {
    if (revision !== _loadRevision) return;
    const msg = error instanceof ApiError ? error.message : error.message;
    tbody.innerHTML = `<tr class="state-row"><td colspan="9">載入失敗:${escHtml(msg)}</td></tr>`;
    showToast('載入訂單失敗:' + msg, true);
  }
}

/**
 * 更新「載入更多」按鈕。
 */
function updateLoadMoreButton() {
  let btn = document.getElementById('admin-load-more-btn');
  const tableSection = document.getElementById('order-tbody')?.closest('.table-wrapper');
  if (!tableSection) return;

  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'admin-load-more-btn';
    btn.className = 'admin-load-more-btn';
    btn.textContent = '載入更多';
    btn.addEventListener('click', () => loadOrders(true));
    tableSection.after(btn);
  }
  const hasMore = _currentPage < _totalPages;
  btn.classList.toggle('hidden', !hasMore);
  const remaining = Math.max(0, _totalCount - _allOrders.length);
  btn.textContent = `載入更多(還剩 ${remaining} 筆)`;
}

/**
 * 由已載入訂單計算統計;只在伺服器未提供 summary 時作為退路。
 * @param {Array<object>} data
 */
export function summarizeLoadedOrders(data) {
  const unpaidOrders = data.filter((o) => !o.is_paid && !o.is_cancelled);
  const unprintedOrders = data.filter((o) => !o.is_printed && !o.is_cancelled);
  return {
    unpaid_count: unpaidOrders.length,
    unpaid_amount: unpaidOrders.reduce((s, o) => s + (o.amount_due ?? o.total_price ?? 0), 0),
    unprinted_count: unprintedOrders.length,
    unprinted_pages: unprintedOrders.reduce((s, o) => s + (o.total_pages || 0), 0),
  };
}

/** 狀態更新或刪除後,只重新取得全庫統計,不重載已顯示的列表。 */
async function refreshSummary() {
  try {
    const data = await apiGet(`${API_BASE}/api/orders?page=1&page_size=1`);
    _summary = data.summary || null;
  } catch {
    _summary = null;
  }
  renderStats(_allOrders);
}

export function renderStats(data) {
  // 伺服器 summary 是全庫統計;本地資料在更新狀態後只作即時退路。
  const stats = _summary || summarizeLoadedOrders(data);
  document.getElementById('stat-unpaid').textContent = 'NT$ ' + stats.unpaid_amount.toLocaleString();
  document.getElementById('stat-unpaid-count').textContent = '共 ' + stats.unpaid_count + ' 筆未付款';
  document.getElementById('stat-unprinted').textContent = stats.unprinted_pages.toLocaleString() + ' 頁';
  document.getElementById('stat-unprinted-pages').textContent = '共 ' + stats.unprinted_count + ' 份待列印';
  document.getElementById('stat-total').textContent = _totalCount || data.length;
  document.getElementById('stat-total-sub').textContent = (_search ? '符合搜尋,' : '') + '已載入 ' + data.length + ' 筆';
}

export function buildSettingBadges(order) {
  const badges = [];
  const cm = order.color_mode;
  const duplex = order.duplex;
  const binding = order.binding;

  badges.push(
    cm === 'color'
      ? '<span class="badge-chip badge-color">彩色</span>'
      : '<span class="badge-chip badge-bw">黑白</span>'
  );
  badges.push(
    duplex === 'double'
      ? '<span class="badge-chip badge-double">雙面</span>'
      : '<span class="badge-chip badge-single">單面</span>'
  );
  // 文件處理方式 + 列印防呆 tooltip(提示對應的印表機設定)
  badges.push(
    order.fit_mode === 'cover'
      ? '<span class="badge-chip badge-fit-cover" title="建議印表機設定:實際大小 Actual Size 或無邊界 Borderless">裁切</span>'
      : '<span class="badge-chip badge-fit-fit" title="建議印表機設定:縮放至可列印區域 / Fit to Printable Area">留白</span>'
  );

  if (binding === 'top_left') badges.push('<span class="badge-chip badge-binding">左上裝訂</span>');
  else if (binding === 'top_right') badges.push('<span class="badge-chip badge-binding">右上裝訂</span>');
  else if (binding === 'short_edge') badges.push('<span class="badge-chip badge-binding">短邊裝訂</span>');
  else if (binding === 'long_edge') badges.push('<span class="badge-chip badge-binding">長邊裝訂</span>');
  else if (binding === 'other') badges.push('<span class="badge-chip badge-binding">其他裝訂</span>');
  else if (binding) badges.push('<span class="badge-chip badge-binding" title="' + escHtml(binding) + '">' + escHtml(binding) + '</span>');

  if (order.pickup_location) {
    badges.push('<span class="badge-chip badge-binding" title="時間:' + escHtml(order.pickup_location) + '">時間:' + escHtml(order.pickup_location) + '</span>');
  }
  return '<div class="setting-badges">' + badges.join('') + '</div>';
}

export function renderTable(data) {
  const tbody = document.getElementById('order-tbody');
  if (!data.length) {
    tbody.innerHTML = '<tr class="state-row"><td colspan="9">目前沒有任何訂單</td></tr>';
    return;
  }
  tbody.innerHTML = data
    .map(
      (order) => `
      <tr id="row-${order.id}">
        <td data-label="#" class="mono">${order.id}</td>
        <td data-label="姓名">${escHtml(order.user_name)}</td>
        <td data-label="檔案" class="admin-file-cell" title="${escHtml(order.file_name)}">${escHtml(order.file_name)}</td>
        <td data-label="頁數" class="mono">${order.total_pages}</td>
        <td data-label="列印設定">${buildSettingBadges(order)}</td>
        <td data-label="金額" class="price">${order.is_cancelled ? '已取消' : `NT$ ${(order.amount_due ?? order.total_price ?? 0).toLocaleString()}`}
          <span class="order-money-detail">原價 ${order.total_price} 元<br>禮物卡${order.is_cancelled ? '已退回' : '折抵'} ${order.gift_card_discount || 0} 元${order.cash_received !== null && order.cash_received !== undefined ? `<br>實收現金 ${order.cash_received} 元` : ''}</span>
        </td>
        <td data-label="已付款">
          <div class="payment-cell">
          ${order.is_cancelled ? '已取消' : order.is_paid
            ? `<span>${order.amount_due === 0 ? '禮物卡全額折抵' : '已付款'}</span>${order.cash_received == null && order.amount_due !== 0 ? `<button type="button" class="btn-outlined" data-order-action="unpay" data-order-id="${order.id}">更正為未付款</button>` : ''}`
            : `<button type="button" class="btn-view-pdf" data-order-action="payment" data-order-id="${order.id}">收款</button>`}
          </div>
        </td>
        <td data-label="已列印">
          <label class="toggle" id="toggle-printed-${order.id}">
            <input type="checkbox" role="switch" aria-label="訂單 #${order.id} 已列印" ${order.is_printed ? 'checked' : ''} ${order.is_cancelled ? 'disabled' : ''}
                   data-order-id="${order.id}" data-order-field="is_printed" />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </td>
        <td data-label="操作">
          <div class="order-actions">
            <button type="button" class="btn-view-pdf" data-order-action="preview" data-order-id="${order.id}">查看</button>
            ${!order.is_printed && !order.is_cancelled ? `<button type="button" class="btn-outlined" data-order-action="cancel" data-order-id="${order.id}">取消訂單</button>` : ''}
            <button type="button" class="btn-delete" data-order-action="delete" data-order-id="${order.id}">刪除</button>
          </div>
        </td>
      </tr>
    `
    )
    .join('');
}

export function findOrder(orderId) {
  return _allOrders.find((o) => o.id === orderId);
}

export async function updateOrder(orderId, field, value, checkbox) {
  const toggle = checkbox.closest('.toggle');
  if (toggle) toggle.classList.add('loading');
  checkbox.disabled = true;
  try {
    await apiPut(`${API_BASE}/api/orders/${orderId}`, { [field]: value });
    const order = findOrder(orderId);
    if (order) order[field] = value;
    renderTable(_allOrders);
    void refreshSummary();
    showToast('訂單 #' + orderId + ' 狀態更新成功');
  } catch (error) {
    checkbox.checked = !value;
    const msg = error instanceof ApiError ? error.message : error.message;
    showToast('更新失敗:' + msg, true);
  } finally {
    if (toggle) toggle.classList.remove('loading');
    checkbox.disabled = false;
  }
}

export async function deleteOrder(orderId) {
  if (!(await showConfirm(`確定要刪除訂單 #${orderId} 嗎?此操作將無法復原。\n刪除不會退回禮物卡折抵；若不再列印，請先使用「取消訂單」。`))) return;
  try {
    await apiDelete(`${API_BASE}/api/orders/${orderId}`);
    _allOrders = _allOrders.filter((o) => o.id !== orderId);
    _totalCount = Math.max(0, _totalCount - 1);
    renderTable(_allOrders);
    void refreshSummary();
    updateLoadMoreButton();
    showToast('訂單已刪除');
  } catch (error) {
    const msg = error instanceof ApiError ? error.message : error.message;
    showToast('刪除失敗:' + msg, true);
  }
}

// 簡易 toast 通知(admin.html 用)
function showToast(msg, isError = false) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast-msg' + (isError ? ' error' : '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
