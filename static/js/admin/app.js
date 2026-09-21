/**
 * 後台主應用模組(admin.html 用)
 * 負責模組協調與事件綁定。
 */

import { loadOrders, updateOrder, deleteOrder, findOrder } from './orders.js';
import { bindAdminGiftCardEvents, loadGiftCards, openPayment, cancelOrder } from './gift-cards.js';
import { apiPut } from '../api.js';
import { showConfirm, showAlert } from '../dialog-api.js';
import { openPdfModal, bindAdminPdfNavButtons, bindAdminFitToggle } from './pdf-modal.js';
import { loadAnnouncements, publishAnnouncement, updateAnnouncementStatus, deleteAnnouncement } from './announcements.js';

function parseId(element, key) {
  const id = Number.parseInt(element?.dataset[key] ?? '', 10);
  return Number.isInteger(id) ? id : null;
}

function bindAdminEvents() {
  document.getElementById('btn-refresh-orders')?.addEventListener('click', () => {
    void loadOrders();
  });
  document.getElementById('btn-publish-announce')?.addEventListener('click', () => {
    void publishAnnouncement();
  });

  const orderTable = document.getElementById('order-tbody');
  orderTable?.addEventListener('change', (event) => {
    const checkbox = event.target.closest?.('[data-order-field]');
    if (!checkbox) return;
    const orderId = parseId(checkbox, 'orderId');
    if (orderId === null) return;
    void updateOrder(orderId, checkbox.dataset.orderField, checkbox.checked, checkbox);
  });
  orderTable?.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-order-action]');
    if (!button) return;
    const orderId = parseId(button, 'orderId');
    if (orderId === null) return;
    if (button.dataset.orderAction === 'preview') void openPdfModal(orderId);
    if (button.dataset.orderAction === 'delete') void deleteOrder(orderId);
    if (button.dataset.orderAction === 'payment') openPayment(findOrder(orderId));
    if (button.dataset.orderAction === 'cancel') void cancelOrder(findOrder(orderId));
    if (button.dataset.orderAction === 'unpay' && await showConfirm('將這筆舊訂單更正為未付款？之後可重新輸入實收金額。')) {
      try {
        await apiPut(`/api/orders/${orderId}`, { is_paid: false });
        await loadOrders();
      } catch (error) { await showAlert(error.message, 'error'); }
    }
  });

  const announcementTable = document.getElementById('announce-tbody');
  announcementTable?.addEventListener('change', (event) => {
    const checkbox = event.target.closest?.('[data-announcement-status]');
    if (!checkbox) return;
    const announcementId = parseId(checkbox, 'announcementId');
    if (announcementId !== null) {
      void updateAnnouncementStatus(announcementId, checkbox.checked, checkbox);
    }
  });
  announcementTable?.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-announcement-action="delete"]');
    if (!button) return;
    const announcementId = parseId(button, 'announcementId');
    if (announcementId !== null) void deleteAnnouncement(announcementId);
  });
}

function initAdmin() {
  bindAdminGiftCardEvents(loadOrders);
  bindAdminEvents();
  bindAdminPdfNavButtons();
  bindAdminFitToggle();
  void loadOrders();
  void loadAnnouncements();
  void loadGiftCards(1);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin, { once: true });
} else {
  initAdmin();
}
