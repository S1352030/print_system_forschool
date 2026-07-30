/**
 * 檔案上傳模組(使用者端 index.html 用)
 * 負責檔案選擇、頁數解析、設定檔、上傳與防呆。
 *
 * 狀態說明:
 *   selectedFiles:使用者選擇的檔案陣列,每個物件含 file/colorMode/duplex/binding/pages
 *   activeFileIndex:目前編輯/預覽的檔案索引
 *   isCooldown:上傳後 7 秒冷卻中,禁止重複提交
 */

import { showAlert, showConfirm } from './dialog-api.js';
import { invalidateHistoryCache, fetchHistory as refreshHistory } from './history.js';
import {
  showPreview,
  resetPreview,
  setFitMode,
  inspectPdfFile,
  releasePdfFile,
} from './preview.js';
import { apiPost, apiPostWithProgress, ApiError } from './api.js';
import { escHtml } from './utils.js';

const MAX_FILES = 5;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const COOLDOWN_SECONDS = 7;
const PRICE_MAP = { bw: 1, color: 2 };

let selectedFiles = [];
let activeFileIndex = 0;
let isCooldown = false;
let cooldownTimer = null;

// DOM 引用(模組頂層取得;此模組在 <script type="module"> 載入,
// 此時 DOM 已就緒,因為 module 預設 defer)
const fileInput = document.getElementById('pdf_file');
const submitBtn = document.getElementById('submit-btn');
const userNameInput = document.getElementById('user_name');
const pickupLocationInput = document.getElementById('pickup_location');
const uploadForm = document.getElementById('uploadForm');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');
const dropArea = document.getElementById('drop-area');

// ── 拖曳上傳事件綁定 ──────────────────────────────────────────
export function bindUploadEvents() {
  if (dropArea) {
    ['dragenter', 'dragover'].forEach((evt) => {
      dropArea.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isCooldown) return;
        dropArea.style.backgroundColor = 'var(--primary-container)';
        dropArea.style.borderColor = 'var(--primary)';
      });
    });
    ['dragleave', 'dragend'].forEach((evt) => {
      dropArea.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropArea.style.backgroundColor = '';
        dropArea.style.borderColor = '';
      });
    });
    dropArea.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropArea.style.backgroundColor = '';
      dropArea.style.borderColor = '';
      if (isCooldown) return;
      const files = e.dataTransfer.files;
      if (files && files.length > 0) addFiles(files);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', function () {
      if (isCooldown) return;
      if (this.files && this.files.length > 0) {
        addFiles(this.files);
        fileInput.value = '';
      }
    });
  }

  if (uploadForm) uploadForm.addEventListener('submit', handleSubmit);
  if (userNameInput) userNameInput.addEventListener('input', checkFormValidity);
  if (pickupLocationInput) pickupLocationInput.addEventListener('input', checkFormValidity);
}

// ── 檔名重複後綴檢查與清除 ────────────────────────────────────
function hasDuplicationPatterns(filename) {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1) return false;
  const name = filename.substring(0, lastDotIndex);
  const hasBrowserSuffix = /\s*\(\d+\)$/.test(name);
  const hasWindowsSuffix = /\s*-\s*(副本|複製|Copy)$/i.test(name);
  const hasMacSuffix = /\s*的(副本|複本|複製)$/.test(name);
  const hasDoubleExt = name.toLowerCase().endsWith('.pdf');
  return hasBrowserSuffix || hasWindowsSuffix || hasMacSuffix || hasDoubleExt;
}

function sanitizeFilename(filename) {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1) return filename;
  let name = filename.substring(0, lastDotIndex);
  const ext = filename.substring(lastDotIndex);
  while (true) {
    const prevName = name;
    name = name.replace(/\s*\(\d+\)$/, '');
    name = name.replace(/\s*-\s*(副本|複製|Copy)$/i, '');
    name = name.replace(/\s*的(副本|複本|複製)$/, '');
    name = name.replace(/[\s\-_]+$/, '');
    if (name.toLowerCase().endsWith('.pdf')) {
      name = name.substring(0, name.length - 4);
    }
    if (name === prevName) break;
  }
  return name + ext;
}

// ── 加入檔案 ──────────────────────────────────────────────────
export async function addFiles(files) {
  if (isCooldown) return;
  let nonPdfFound = false;
  let duplicateFound = false;
  let overLimit = false;
  let emptyFound = false;
  let oversizedFound = false;
  const newlyAdded = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      nonPdfFound = true;
      continue;
    }
    if (file.size === 0) {
      emptyFound = true;
      continue;
    }
    if (file.size > MAX_PDF_BYTES) {
      oversizedFound = true;
      continue;
    }

    let fileToUpload = file;
    if (hasDuplicationPatterns(file.name)) {
      const cleanName = sanitizeFilename(file.name);
      if (await showConfirm(`系統發現檔案「${file.name}」的名稱似乎是複製產生的,是否需要自動還原為乾淨檔名「${cleanName}」再上傳?`)) {
        fileToUpload = new File([file], cleanName, { type: file.type, lastModified: file.lastModified });
      }
    }

    if (selectedFiles.some((f) => f.file.name === fileToUpload.name && f.file.size === fileToUpload.size)) {
      duplicateFound = true;
      continue;
    }
    if (selectedFiles.length < MAX_FILES) {
      const fileObj = {
        file: fileToUpload,
        colorMode: 'bw',
        duplex: 'single',
        fitMode: 'fit',
        binding: 'top_left',
        bindingOtherText: '',
        pages: null,
        parseError: null,
      };
      selectedFiles.push(fileObj);
      newlyAdded.push(fileObj);
    } else {
      overLimit = true;
      break;
    }
  }

  if (nonPdfFound) await showAlert('僅接受 PDF 格式的檔案!', 'warning');
  if (emptyFound) await showAlert('空白 PDF 無法上傳。', 'warning');
  if (oversizedFound) await showAlert('PDF 單檔不可超過 20 MB。', 'warning');
  if (duplicateFound) await showAlert('已忽略重複選擇的檔案。', 'warning');
  if (overLimit) await showAlert(`最多只能選擇 ${MAX_FILES} 個檔案!`, 'warning');

  if (selectedFiles.length > 0) {
    activeFileIndex = selectedFiles.length - 1;
  }

  renderFileList();
  checkFormValidity();
  updatePriceSummary();

  if (selectedFiles.length > 0) {
    await showPreview(selectedFiles[activeFileIndex]);
  }

  // 非同步解析每一份文件的頁數(優先本地解析,失敗才呼叫 API)
  for (const fileObj of newlyAdded) {
    const localPages = await getLocalPdfPageCount(fileObj.file);
    if (localPages !== null && localPages > 0) {
      fileObj.pages = localPages;
      fileObj.parseError = null;
    } else {
      try {
        const formData = new FormData();
        formData.append('file', fileObj.file);
        const result = await apiPost('/api/check-pages', formData, { isForm: true });
        fileObj.pages = result.pages;
        fileObj.parseError = null;
      } catch (e) {
        fileObj.pages = null;
        fileObj.parseError = e instanceof ApiError ? e.message : '無法解析 PDF';
        await showAlert(
          `檔案「${fileObj.file.name}」無法取得頁數：${fileObj.parseError}`,
          'error',
        );
      }
    }
    if (fileObj.pages === 1) {
      fileObj.binding = null;
      fileObj.duplex = 'single';
    }
    renderFileList();
    checkFormValidity();
    updatePriceSummary();
  }
}

// ── 檔案設定變更(供 onclick 呼叫)──────────────────────────────
export function updateFileSetting(idx, key, value) {
  if (isCooldown) return;
  if (selectedFiles[idx]) {
    selectedFiles[idx][key] = value;
    renderFileList();
    checkFormValidity();
    updatePriceSummary();
  }
}

export function updateFileOtherText(idx, value) {
  if (isCooldown) return;
  if (selectedFiles[idx]) {
    selectedFiles[idx].bindingOtherText = value;
    checkFormValidity();
  }
}

/**
 * 切換文件處理方式(fit 留白 / cover 裁切)。
 * 不呼叫 renderFileList()(預覽由 setFitMode 內部即時重繪,避免卡片重渲染打斷)。
 */
export function updateFitMode(idx, value) {
  if (isCooldown) return;
  if (selectedFiles[idx]) {
    selectedFiles[idx].fitMode = value;
    // 即時切換預覽模式(重繪當前頁)
    setFitMode(value, false);
  }
}

export function removeFile(idx) {
  if (isCooldown) return;
  const removed = selectedFiles[idx];
  if (removed?.file) void releasePdfFile(removed.file);
  selectedFiles.splice(idx, 1);
  if (activeFileIndex >= selectedFiles.length) {
    activeFileIndex = Math.max(0, selectedFiles.length - 1);
  }
  renderFileList();
  checkFormValidity();
  updatePriceSummary();
  if (selectedFiles.length > 0) {
    showPreview(selectedFiles[activeFileIndex]);
  } else {
    resetPreview();
  }
}

export function changeActiveFile(direction) {
  if (isCooldown) return;
  const newIdx = activeFileIndex + direction;
  if (newIdx >= 0 && newIdx < selectedFiles.length) {
    activeFileIndex = newIdx;
    renderFileList();
    showPreview(selectedFiles[activeFileIndex]);
  }
}

export function previewFile(idx) {
  if (selectedFiles[idx]) showPreview(selectedFiles[idx]);
}

// ── 渲染檔案清單(只渲染當前啟動的檔案卡片)──────────────────────
function renderFileList() {
  const listContainer = document.getElementById('file-list-container');
  const filesList = document.getElementById('selected-files-list');
  if (!listContainer || !filesList) return;

  if (selectedFiles.length === 0) {
    listContainer.classList.add('hidden');
    resetPreview();
    return;
  }
  listContainer.classList.remove('hidden');

  if (activeFileIndex >= selectedFiles.length) {
    activeFileIndex = Math.max(0, selectedFiles.length - 1);
  }
  if (activeFileIndex < 0) activeFileIndex = 0;

  const pagerInfo = document.getElementById('file-pager-info');
  const prevBtn = document.getElementById('file-pager-prev');
  const nextBtn = document.getElementById('file-pager-next');
  if (pagerInfo) pagerInfo.textContent = `${activeFileIndex + 1} / ${selectedFiles.length}`;
  if (prevBtn) prevBtn.disabled = activeFileIndex === 0;
  if (nextBtn) nextBtn.disabled = activeFileIndex === selectedFiles.length - 1;

  let hasSettingsError = false;
  for (const f of selectedFiles) {
    if (f.binding === 'other' && !f.bindingOtherText.trim()) {
      hasSettingsError = true;
      break;
    }
  }
  const warningMsg = document.getElementById('pager-warning-message');
  if (warningMsg) warningMsg.classList.toggle('hidden', !hasSettingsError);

  const fileObj = selectedFiles[activeFileIndex];
  const idx = activeFileIndex;
  const file = fileObj.file;
  const pagesText = fileObj.parseError
    ? `<span class="file-item-pages file-item-pages--error">(PDF 無法解析)</span>`
    : fileObj.pages === null
    ? `<span class="file-item-pages">(計算頁數中…)</span>`
    : `<span class="file-item-pages">(${fileObj.pages} 頁)</span>`;
  const showBinding = fileObj.pages === null || fileObj.pages > 1;
  const showDuplex = fileObj.pages === null || fileObj.pages > 1;

  const bindingHtml = showBinding ? `
        <div class="setting-col">
          <span class="setting-label">裝訂位置</span>
          <div class="chip-group">
            <label>
              <input type="radio" name="binding_${idx}" value="top_left" ${fileObj.binding === 'top_left' ? 'checked' : ''} onchange="updateFileSetting(${idx}, 'binding', 'top_left')">
              <span class="material-symbols-outlined chip-icon"><svg><use href="#i-north_west"/></svg></span>
              <span>左上角</span>
            </label>
            <label>
              <input type="radio" name="binding_${idx}" value="top_right" ${fileObj.binding === 'top_right' ? 'checked' : ''} onchange="updateFileSetting(${idx}, 'binding', 'top_right')">
              <span class="material-symbols-outlined chip-icon"><svg><use href="#i-north_east"/></svg></span>
              <span>右上角</span>
            </label>
            <label>
              <input type="radio" name="binding_${idx}" value="other" ${fileObj.binding === 'other' ? 'checked' : ''} onchange="updateFileSetting(${idx}, 'binding', 'other')">
              <span class="material-symbols-outlined chip-icon"><svg><use href="#i-edit"/></svg></span>
              <span>其他</span>
            </label>
          </div>
          <input type="text" id="binding_other_text_${idx}" class="binding-other-input binding-other-text-input ${fileObj.binding === 'other' ? '' : 'hidden'}" placeholder="請說明裝訂方式… (限 10 字)" maxlength="10" value="${escHtml(fileObj.bindingOtherText || '')}" oninput="updateFileOtherText(${idx}, this.value)">
        </div>
  ` : '';

  const duplexHtml = showDuplex ? `
            <div class="setting-col-flex">
              <span class="setting-label">列印方式</span>
              <div class="chip-group">
                <label>
                  <input type="radio" name="duplex_${idx}" value="single" ${fileObj.duplex === 'single' ? 'checked' : ''} onchange="updateFileSetting(${idx}, 'duplex', 'single')">
                  <span class="material-symbols-outlined chip-icon"><svg><use href="#i-article"/></svg></span>
                  <span>單面</span>
                </label>
                <label>
                  <input type="radio" name="duplex_${idx}" value="double" ${fileObj.duplex === 'double' ? 'checked' : ''} onchange="updateFileSetting(${idx}, 'duplex', 'double')">
                  <span class="material-symbols-outlined chip-icon"><svg><use href="#i-menu_book"/></svg></span>
                  <span>雙面</span>
                </label>
              </div>
            </div>
  ` : '';

  // 文件處理方式:fit(留白)/cover(裁切),即時反映於右側預覽
  const fitModeHtml = `
            <div class="setting-col-flex">
              <span class="setting-label">文件處理</span>
              <div class="chip-group">
                <label>
                  <input type="radio" name="fit_mode_${idx}" value="fit" ${fileObj.fitMode === 'fit' ? 'checked' : ''} onchange="updateFitMode(${idx}, 'fit')">
                  <span class="material-symbols-outlined chip-icon"><svg><use href="#i-fit_page"/></svg></span>
                  <span>留白</span>
                </label>
                <label>
                  <input type="radio" name="fit_mode_${idx}" value="cover" ${fileObj.fitMode === 'cover' ? 'checked' : ''} onchange="updateFitMode(${idx}, 'cover')">
                  <span class="material-symbols-outlined chip-icon"><svg><use href="#i-crop"/></svg></span>
                  <span>裁切</span>
                </label>
              </div>
            </div>
  `;

  filesList.innerHTML = `
    <div class="file-item-card">
      <div class="file-item-header">
        <div class="file-item-title-wrapper" onclick="previewFile(${idx})">
          <span class="material-symbols-outlined file-item-icon"><svg><use href="#i-description"/></svg></span>
          <span class="file-item-name" title="${escHtml(file.name)}">${escHtml(file.name)} (${(file.size / 1024).toFixed(0)} KB) ${pagesText}</span>
        </div>
        <button type="button" onclick="removeFile(${idx})" class="file-item-remove-btn"
                aria-label="移除 ${escHtml(file.name)}">
          <span class="material-symbols-outlined remove-icon"><svg><use href="#i-close"/></svg></span>
        </button>
      </div>
      <div class="file-item-settings">
        <div class="file-item-options">
          <div class="setting-col-flex">
            <span class="setting-label">色彩模式</span>
            <div class="chip-group">
              <label>
                <input type="radio" name="color_mode_${idx}" value="bw" ${fileObj.colorMode === 'bw' ? 'checked' : ''} onchange="updateFileSetting(${idx}, 'colorMode', 'bw')">
                <span class="material-symbols-outlined chip-icon"><svg><use href="#i-invert_colors"/></svg></span>
                <span>黑白</span>
              </label>
              <label>
                <input type="radio" name="color_mode_${idx}" value="color" ${fileObj.colorMode === 'color' ? 'checked' : ''} onchange="updateFileSetting(${idx}, 'colorMode', 'color')">
                <span class="material-symbols-outlined chip-icon"><svg><use href="#i-palette"/></svg></span>
                <span>彩色</span>
              </label>
            </div>
          </div>
          ${duplexHtml}
          ${fitModeHtml}
        </div>
        ${bindingHtml}
      </div>
    </div>
  `;
}

// ── 表單驗證 ──────────────────────────────────────────────────
export function checkFormValidity() {
  if (!submitBtn) return;
  if (isCooldown) {
    submitBtn.disabled = true;
    return;
  }
  let allSettingsOk = selectedFiles.every(
    (fileObj) => Number.isInteger(fileObj.pages) && fileObj.pages > 0 && !fileObj.parseError,
  );
  for (const fileObj of selectedFiles) {
    if (fileObj.binding === 'other' && !fileObj.bindingOtherText.trim()) {
      allSettingsOk = false;
      break;
    }
  }
  const warningMsg = document.getElementById('pager-warning-message');
  if (warningMsg) warningMsg.classList.toggle('hidden', allSettingsOk);

  const pickupVal = pickupLocationInput ? pickupLocationInput.value.trim() : '';
  const pickupLengthOk = pickupVal.length > 0 && pickupVal.length <= 20;
  const pickupError = document.getElementById('pickup-error');
  if (pickupLocationInput && pickupError) {
    pickupError.style.display = pickupLocationInput.value.length > 20 ? 'block' : 'none';
  }
  const nameOk = !!(userNameInput && userNameInput.value.trim());
  submitBtn.disabled = !(nameOk && selectedFiles.length > 0 && allSettingsOk && pickupLengthOk);
}

function toggleFormInputs(disabled) {
  if (userNameInput) userNameInput.disabled = disabled;
  if (pickupLocationInput) pickupLocationInput.disabled = disabled;
  const listContainer = document.getElementById('file-list-container');
  const opacity = disabled ? '0.6' : '1';
  const pointerEvents = disabled ? 'none' : 'auto';
  if (listContainer) {
    listContainer.style.pointerEvents = pointerEvents;
    listContainer.style.opacity = opacity;
  }
  if (dropArea) {
    dropArea.style.pointerEvents = pointerEvents;
    dropArea.style.opacity = opacity;
  }
}

// ── 上傳後冷卻 ────────────────────────────────────────────────
function startCooldown() {
  isCooldown = true;
  toggleFormInputs(true);
  let secondsLeft = COOLDOWN_SECONDS;

  const banner = document.getElementById('cooldown-banner');
  const bannerText = document.getElementById('cooldown-banner-text');
  if (banner && bannerText) {
    banner.classList.remove('hidden');
    bannerText.textContent = `上傳已完成!為避免重複提交,系統冷卻中,請稍候 ${secondsLeft} 秒...`;
  }
  if (btnSpinner) btnSpinner.classList.add('hidden');
  if (submitBtn) submitBtn.disabled = true;
  if (btnText) btnText.textContent = `已上傳完成!請稍候 ${secondsLeft} 秒後再繼續上傳...`;

  cooldownTimer = setInterval(() => {
    secondsLeft--;
    if (secondsLeft > 0) {
      if (btnText) btnText.textContent = `已上傳完成!請稍候 ${secondsLeft} 秒後再繼續上傳...`;
      if (bannerText) bannerText.textContent = `上傳已完成!為避免重複提交,系統冷卻中,請稍候 ${secondsLeft} 秒...`;
    } else {
      clearInterval(cooldownTimer);
      isCooldown = false;
      toggleFormInputs(false);
      if (btnText) btnText.textContent = '確認上傳';
      if (banner) banner.classList.add('hidden');
      checkFormValidity();
    }
  }, 1000);
}

// ── 上傳進度條更新 ────────────────────────────────────────────
function updateUploadProgress(percent, fileLabel) {
  const bar = document.getElementById('upload-progress-bar');
  const fill = document.getElementById('upload-progress-fill');
  const text = document.getElementById('upload-progress-text');
  if (bar && fill && text) {
    bar.classList.remove('hidden');
    fill.style.width = percent + '%';
    text.textContent = `${fileLabel} ${percent}%`;
  }
}

function hideUploadProgress() {
  const bar = document.getElementById('upload-progress-bar');
  if (bar) bar.classList.add('hidden');
}

// ── 表單提交處理 ──────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  if (isCooldown) return;
  if (selectedFiles.length === 0) return;

  if (submitBtn) submitBtn.disabled = true;
  if (btnSpinner) btnSpinner.classList.remove('hidden');

  const nameVal = userNameInput.value.trim();
  const pickupLocationVal = pickupLocationInput ? pickupLocationInput.value.trim() : '';

  let uploadedCount = 0;
  let totalPaidPrice = 0;
  let hasError = false;

  toggleFormInputs(true);

  for (let i = 0; i < selectedFiles.length; i++) {
    const fileObj = selectedFiles[i];
    if (btnText) btnText.textContent = `正在上傳第 ${i + 1}/${selectedFiles.length} 個檔案...`;

    const formData = new FormData();
    formData.append('user_name', nameVal);
    formData.append('file', fileObj.file);
    formData.append('color_mode', fileObj.colorMode);
    formData.append('duplex', fileObj.duplex);
    formData.append('fit_mode', fileObj.fitMode);

    let bindingVal = fileObj.binding;
    if (bindingVal === 'other') bindingVal = fileObj.bindingOtherText.trim();
    if (bindingVal) formData.append('binding', bindingVal);
    if (pickupLocationVal) formData.append('pickup_location', pickupLocationVal);

    try {
      const result = await apiPostWithProgress(
        '/api/upload',
        formData,
        (percent) => updateUploadProgress(percent, `[${i + 1}/${selectedFiles.length}] ${fileObj.file.name}`)
      );
      uploadedCount++;
      totalPaidPrice += result.total_price;
    } catch (error) {
      hideUploadProgress();
      const errMsg = error instanceof ApiError ? error.message : '網路錯誤';
      await showAlert(`檔案「${fileObj.file.name}」上傳失敗:${errMsg}`, 'error');
      hasError = true;
      break;
    }
  }

  hideUploadProgress();

  if (uploadedCount > 0) {
    await showAlert(`上傳成功!共成功上傳 ${uploadedCount} 個檔案,應收金額 NT$ ${totalPaidPrice} 元。\n通知已發送給管理員。`, 'success');

    sessionStorage.setItem('print_user_name', nameVal);
    const historySearchInput = document.getElementById('history_search_name');
    if (historySearchInput) historySearchInput.value = nameVal;

    if (uploadForm) uploadForm.reset();
    if (userNameInput) userNameInput.value = nameVal;
    await Promise.allSettled(selectedFiles.map((item) => releasePdfFile(item.file)));
    selectedFiles = [];
    renderFileList();
    updatePriceSummary();
    resetPreview();
    startCooldown();

    invalidateHistoryCache();
    refreshHistory();
  } else {
    if (btnText) btnText.textContent = '確認上傳';
    if (btnSpinner) btnSpinner.classList.add('hidden');
    toggleFormInputs(false);
    checkFormValidity();
  }
}

// ── 本地 PDF 頁數解析(避免重複上傳至 /api/check-pages)─────────
async function getLocalPdfPageCount(file) {
  try {
    return await inspectPdfFile(file);
  } catch (e) {
    return null;
  }
}

// ── 即時試算金額 ──────────────────────────────────────────────
export function updatePriceSummary() {
  const summaryCard = document.getElementById('price-summary');
  const breakdownDiv = document.getElementById('price-breakdown');
  const totalAmountSpan = document.getElementById('price-total-amount');
  const pendingHint = document.getElementById('price-pending-hint');
  if (!summaryCard || !breakdownDiv || !totalAmountSpan) return;

  if (selectedFiles.length === 0) {
    summaryCard.classList.add('hidden');
    return;
  }
  summaryCard.classList.remove('hidden');

  let totalPrice = 0;
  let hasPending = false;
  let rows = '';

  selectedFiles.forEach((fileObj) => {
    const fileName = fileObj.file.name;
    const shortName = fileName.length > 25 ? fileName.substring(0, 22) + '...' : fileName;
    const pricePerPage = PRICE_MAP[fileObj.colorMode] || 1;

    if (fileObj.pages === null) {
      hasPending = true;
      rows += `<div class="price-file-row">
        <span class="file-label" title="${escHtml(fileName)}">${escHtml(shortName)}</span>
        <span class="file-price file-price-pending">計算中...</span>
      </div>`;
    } else {
      const filePrice = fileObj.pages * pricePerPage;
      totalPrice += filePrice;
      const colorLabel = fileObj.colorMode === 'color' ? '彩色' : '黑白';
      rows += `<div class="price-file-row">
        <span class="file-label" title="${escHtml(fileName)}">${escHtml(shortName)}</span>
        <span class="file-price">${fileObj.pages} 頁 × ${pricePerPage} 元 (${colorLabel}) = ${filePrice} 元</span>
      </div>`;
    }
  });

  breakdownDiv.innerHTML = rows;
  totalAmountSpan.textContent = 'NT$ ' + totalPrice.toLocaleString() + ' 元';
  if (pendingHint) {
    if (hasPending) {
      pendingHint.classList.remove('hidden');
      totalAmountSpan.textContent += '+';
    } else {
      pendingHint.classList.add('hidden');
    }
  }
}
