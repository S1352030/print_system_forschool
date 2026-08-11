/**
 * 後台公告管理模組(admin.html 用)
 */

import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '../api.js';
import { escHtml, formatDate } from '../utils.js';
import { showConfirm } from '../dialog-api.js';

const API_BASE = '';
let announcements = [];

export async function loadAnnouncements() {
  const tbody = document.getElementById('announce-tbody');
  tbody.innerHTML = '<tr class="state-row"><td colspan="4"><span class="spinner"></span>載入公告中…</td></tr>';
  try {
    const data = await apiGet(API_BASE + '/api/admin/announcements');
    announcements = data;
    renderAnnouncements(announcements);
  } catch (error) {
    const msg = error instanceof ApiError ? error.message : error.message;
    tbody.innerHTML = '<tr class="state-row"><td colspan="4">載入失敗:' + escHtml(msg) + '</td></tr>';
  }
}

export function renderAnnouncements(data) {
  const tbody = document.getElementById('announce-tbody');
  if (!data.length) {
    tbody.innerHTML = '<tr class="state-row"><td colspan="4">目前沒有任何公告</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(ann => `
    <tr>
      <td>${escHtml(ann.content)}</td>
      <td class="mono">${formatDate(ann.created_at)}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" title="顯示" ${ann.is_active ? 'checked' : ''}
                 data-announcement-id="${ann.id}" data-announcement-status />
          <span class="toggle-track"></span>
          <span class="toggle-thumb"></span>
        </label>
      </td>
      <td>
        <button type="button" class="btn-delete" data-announcement-action="delete" data-announcement-id="${ann.id}">🗑️ 刪除</button>
      </td>
    </tr>
  `).join('');
}

export async function publishAnnouncement() {
  const textEl = document.getElementById('announce-input');
  const btn = document.getElementById('btn-publish-announce');
  const content = textEl.value.trim();
  if (!content) {
    showToast('公告內容不能為空', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = '發布中...';
  try {
    await apiPost(API_BASE + '/api/announcements', { content });
    showToast('公告發布成功!');
    textEl.value = '';
    loadAnnouncements();
  } catch (error) {
    const msg = error instanceof ApiError ? error.message : error.message;
    showToast('發布失敗:' + msg, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '📢 發布公告';
  }
}

export async function updateAnnouncementStatus(id, isActive, checkbox) {
  const toggle = checkbox.closest('.toggle');
  toggle.classList.add('loading');
  checkbox.disabled = true;
  try {
    await apiPut(API_BASE + '/api/announcements/' + id, { is_active: isActive });
    const ann = announcements.find(a => a.id === id);
    if (ann) ann.is_active = isActive;
    showToast('公告 #' + id + ' 狀態更新成功');
  } catch (error) {
    checkbox.checked = !isActive;
    const msg = error instanceof ApiError ? error.message : error.message;
    showToast('更新公告狀態失敗:' + msg, true);
  } finally {
    toggle.classList.remove('loading');
    checkbox.disabled = false;
  }
}

export async function deleteAnnouncement(id) {
  if (!(await showConfirm(`確定要刪除公告 #${id} 嗎?此操作將無法復原。`))) return;
  try {
    await apiDelete(API_BASE + '/api/announcements/' + id);
    announcements = announcements.filter(a => a.id !== id);
    renderAnnouncements(announcements);
    showToast('公告已成功刪除');
  } catch (error) {
    const msg = error instanceof ApiError ? error.message : error.message;
    showToast('刪除公告失敗:' + msg, true);
  }
}

function showToast(msg, isError = false) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast-msg' + (isError ? ' error' : '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
