import { apiGet, apiPost, apiPut } from '../api.js';
import { escHtml, formatDate } from '../utils.js';
import { showAlert, showConfirm } from '../dialog-api.js';

let refreshOrders = async () => {};
let cardsPage = 1;
let cardsSearch = '';
let listRevision = 0;
let detailId = null;
let detailPage = 1;
let detailRevision = 0;
let currentOrder = null;
let paymentBusy = false;
const pendingPayments = new Map();
const pendingCancels = new Map();
const byId = (id) => document.getElementById(id);
const due = (order) => order.amount_due ?? order.total_price;

async function copyCode(code, button) {
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = '已複製';
  } catch {
    await showAlert(`請選取並複製此代碼：\n${code}`);
  }
}

export async function loadGiftCards(page = cardsPage) {
  const revision = ++listRevision;
  byId('gift-admin-status').textContent = '載入中…';
  try {
    const result = await apiPost('/api/admin/gift-cards/search', { page, search: cardsSearch });
    if (revision !== listRevision) return;
    cardsPage = result.page;
    byId('gift-card-list').innerHTML = result.items.map((card) => `
      <article class="gift-card-entry">
        <strong>餘額 NT$ ${card.balance} 元</strong> · ${!card.is_active ? '已停用' : card.balance ? '可使用' : '已用完'}
        <code>${escHtml(card.code)}</code>
        <p>發放 ${card.initial_amount} 元 · 來源訂單 #${card.source_order_id}<br>${formatDate(card.created_at)} · 無使用期限</p>
        ${card.note ? `<p>${escHtml(card.note)}</p>` : ''}
        <div class="gift-admin-controls">
          <button type="button" class="btn-view-pdf" data-copy-code="${escHtml(card.code)}">複製代碼</button>
          <button type="button" class="btn-view-pdf" data-card-detail="${card.id}">交易紀錄</button>
          <button type="button" class="btn-view-pdf" data-card-toggle="${card.id}" data-card-active="${!card.is_active}">${card.is_active ? '停用' : '重新啟用'}</button>
        </div>
      </article>`).join('');
    byId('gift-admin-status').textContent = result.total ? `共 ${result.total} 張禮物卡` : '目前沒有符合的禮物卡。';
    byId('gift-page').textContent = `${cardsPage} / ${Math.max(1, result.total_pages)}`;
    byId('gift-prev').disabled = cardsPage <= 1;
    byId('gift-next').disabled = cardsPage >= result.total_pages;
  } catch (error) {
    if (revision === listRevision) byId('gift-admin-status').textContent = `載入失敗：${error.message}`;
  }
}

async function showDetail(id, page = 1) {
  const revision = ++detailRevision;
  detailId = id;
  detailPage = page;
  const dialog = byId('gift-detail-dialog');
  if (!dialog.open) dialog.showModal();
  byId('gift-detail-body').textContent = '載入中…';
  byId('gift-detail-prev').disabled = true;
  byId('gift-detail-next').disabled = true;
  try {
    const result = await apiGet(`/api/admin/gift-cards/${id}?page=${page}`);
    if (revision !== detailRevision) return;
    const labels = { issue: '收款差額發卡', redeem: '列印折抵', refund: '取消訂單退回' };
    byId('gift-detail-body').innerHTML = `<code>${escHtml(result.card.code)}</code><p>目前餘額 NT$ ${result.card.balance} 元</p>` + result.items.map((row) => `
      <div class="finance-transaction"><strong>${labels[row.kind] || escHtml(row.kind)} ${row.amount > 0 ? '+' : ''}${row.amount} 元</strong>
      <p>訂單 #${row.order_id} · ${escHtml(row.order_summary)}<br>交易後餘額 ${row.balance_after} 元<br>${formatDate(row.created_at)}</p></div>`).join('');
    byId('gift-detail-page').textContent = `${page} / ${Math.max(1, result.total_pages)}`;
    byId('gift-detail-prev').disabled = page <= 1;
    byId('gift-detail-next').disabled = page >= result.total_pages;
  } catch (error) {
    if (revision === detailRevision) byId('gift-detail-body').textContent = error.message;
  }
}

function updatePaymentPreview() {
  if (!currentOrder) return;
  const input = byId('payment-cash');
  const cash = input.value === '' ? NaN : Number(input.value);
  const extra = cash - due(currentOrder);
  const valid = Number.isSafeInteger(cash) && cash <= 1000000 && extra >= 0;
  byId('payment-submit').disabled = !valid || paymentBusy;
  byId('payment-preview').textContent = !valid ? `請輸入至少 ${due(currentOrder)} 元的整數金額。`
    : extra ? `實收 ${cash} 元 − 應收 ${due(currentOrder)} 元 = 發放 ${extra} 元禮物卡` : '金額剛好，不需發放禮物卡。';
}

export function openPayment(order) {
  if (!order || paymentBusy) return;
  currentOrder = order;
  const pending = pendingPayments.get(order.id);
  byId('payment-form').hidden = false;
  byId('payment-title').textContent = `訂單 #${order.id} 收款`;
  byId('payment-summary').textContent = `${order.user_name} · ${order.file_name}\n原價 ${order.total_price} 元 − 禮物卡折抵 ${order.gift_card_discount || 0} 元\n本次應收 ${due(order)} 元`;
  byId('payment-cash').value = pending?.cash_received ?? due(order);
  byId('payment-note').value = pending?.note ?? '';
  byId('payment-cash').readOnly = !!pending;
  byId('payment-note').readOnly = !!pending;
  byId('payment-submit').textContent = pending ? '重試確認收款' : '確認收款';
  byId('payment-result').textContent = pending ? '上次收款結果尚未確認，重試會查回同一次結果，不會重複發卡。' : '';
  updatePaymentPreview();
  byId('payment-dialog').showModal();
  byId('payment-cash').focus();
  byId('payment-cash').select();
}

async function submitPayment(event) {
  event.preventDefault();
  if (paymentBusy || !currentOrder || byId('payment-submit').disabled) return;
  paymentBusy = true;
  const order = currentOrder;
  let payload = pendingPayments.get(order.id);
  if (!payload) {
    payload = { request_id: crypto.randomUUID(), cash_received: Number(byId('payment-cash').value), note: byId('payment-note').value };
    pendingPayments.set(order.id, payload);
  }
  byId('payment-cash').readOnly = true;
  byId('payment-note').readOnly = true;
  byId('payment-submit').disabled = true;
  byId('payment-result').textContent = '正在確認收款…';
  try {
    const result = await apiPost(`/api/admin/orders/${order.id}/payment`, payload);
    pendingPayments.delete(order.id);
    byId('payment-form').hidden = true;
    byId('payment-title').textContent = '收款完成';
    byId('payment-result').innerHTML = result.gift_card
      ? `<p>已收 ${result.cash_received} 元，多付的 ${result.gift_card.initial_amount} 元已轉成禮物卡。請將代碼交給客人。</p><code>${escHtml(result.gift_card.code)}</code><button type="button" class="btn-view-pdf" data-copy-code="${escHtml(result.gift_card.code)}">複製代碼</button><p>無使用期限，可分次使用。</p>`
      : `<p>已收 ${result.cash_received} 元，訂單已標記付款完成。</p>`;
    await Promise.allSettled([refreshOrders(), loadGiftCards(1)]);
  } catch (error) {
    const knownFailure = error.status >= 400 && error.status < 500;
    if (knownFailure) pendingPayments.delete(order.id);
    byId('payment-cash').readOnly = !knownFailure;
    byId('payment-note').readOnly = !knownFailure;
    byId('payment-result').textContent = `${error.message}${knownFailure ? '' : '。結果尚未確認，請按重試查回結果。'}`;
    byId('payment-submit').textContent = knownFailure ? '確認收款' : '重試確認收款';
  } finally {
    paymentBusy = false;
    updatePaymentPreview();
  }
}

export async function cancelOrder(order) {
  if (!order) return;
  if (!(await showConfirm(`取消訂單 #${order.id}？禮物卡折抵 ${order.gift_card_discount || 0} 元會退回原卡。${order.is_paid && due(order) > 0 ? `\n請另外退回現金 ${due(order)} 元；原先多付款所發的禮物卡仍保留。` : ''}`))) return;
  const requestId = pendingCancels.get(order.id) || crypto.randomUUID();
  pendingCancels.set(order.id, requestId);
  try {
    const result = await apiPost(`/api/admin/orders/${order.id}/cancel`, { request_id: requestId });
    pendingCancels.delete(order.id);
    await Promise.allSettled([refreshOrders(), loadGiftCards()]);
    await showAlert(`訂單已取消，禮物卡退回 ${result.refunded} 元。${result.cash_refund_due ? `\n另需退回現金 ${result.cash_refund_due} 元，請自行處理。` : ''}`);
  } catch (error) {
    await showAlert(error.message, 'error');
  }
}

export function bindAdminGiftCardEvents(onOrdersChanged) {
  refreshOrders = onOrdersChanged;
  byId('payment-form').addEventListener('submit', submitPayment);
  byId('payment-cash').addEventListener('input', updatePaymentPreview);
  byId('payment-dialog').addEventListener('cancel', (event) => { if (paymentBusy) event.preventDefault(); });
  byId('gift-search-form').addEventListener('submit', (event) => {
    event.preventDefault(); cardsSearch = byId('gift-search').value.trim(); void loadGiftCards(1);
  });
  byId('gift-prev').addEventListener('click', () => { void loadGiftCards(cardsPage - 1); });
  byId('gift-next').addEventListener('click', () => { void loadGiftCards(cardsPage + 1); });
  byId('gift-detail-prev').addEventListener('click', () => { void showDetail(detailId, detailPage - 1); });
  byId('gift-detail-next').addEventListener('click', () => { void showDetail(detailId, detailPage + 1); });
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.closeFinance) {
      if (button.dataset.closeFinance !== 'payment-dialog' || !paymentBusy) byId(button.dataset.closeFinance).close();
    }
    if (button.dataset.copyCode) await copyCode(button.dataset.copyCode, button);
    if (button.dataset.cardDetail) await showDetail(Number(button.dataset.cardDetail));
    if (button.dataset.cardToggle) {
      const active = button.dataset.cardActive === 'true';
      if (!active && !(await showConfirm('停用後，這張卡將暫時無法折抵。確定停用？'))) return;
      button.disabled = true;
      try {
        await apiPut(`/api/admin/gift-cards/${button.dataset.cardToggle}`, { is_active: active });
        await loadGiftCards();
      } catch (error) { await showAlert(error.message, 'error'); }
      finally { button.disabled = false; }
    }
  });
}
