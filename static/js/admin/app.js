/**
 * 後台主應用模組(admin.html 用)
 * 負責模組協調與把 inline onclick 用到的函式掛到 window。
 */

import { loadOrders, updateOrder, deleteOrder } from './orders.js';
import { openPdfModal, closePdfModal, closeModal, downloadCurrentPdf, bindAdminPdfNavButtons } from './pdf-modal.js';
import { loadAnnouncements, publishAnnouncement, updateAnnouncementStatus, deleteAnnouncement } from './announcements.js';

// 把 inline onclick 的函式掛到 window
window.loadOrders = loadOrders;
window.updateOrder = updateOrder;
window.deleteOrder = deleteOrder;
window.openPdfModal = openPdfModal;
window.closePdfModal = closePdfModal;
window.closeModal = closeModal;
window.downloadCurrentPdf = downloadCurrentPdf;
window.publishAnnouncement = publishAnnouncement;
window.updateAnnouncementStatus = updateAnnouncementStatus;
window.deleteAnnouncement = deleteAnnouncement;

// 初始化
bindAdminPdfNavButtons();
loadOrders();
loadAnnouncements();
