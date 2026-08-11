/**
 * 後台主應用模組(admin.html 用)
 * 負責模組協調與事件綁定。
 */

import { loadOrders, updateOrder, deleteOrder } from './orders.js';
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
  orderTable?.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-order-action]');
    if (!button) return;
    const orderId = parseId(button, 'orderId');
    if (orderId === null) return;
    if (button.dataset.orderAction === 'preview') void openPdfModal(orderId);
    if (button.dataset.orderAction === 'delete') void deleteOrder(orderId);
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
  bindAdminEvents();
  bindAdminPdfNavButtons();
  bindAdminFitToggle();
  void loadOrders();
  void loadAnnouncements();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin, { once: true });
} else {
  initAdmin();
}
