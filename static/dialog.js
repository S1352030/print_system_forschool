const dialogQueue = [];
let isDialogShowing = false;

  const ICONS = {
    info: `<svg class="m3-dialog-icon-svg m3-dialog-type-info" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`,
    success: `<svg class="m3-dialog-icon-svg m3-dialog-type-success" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
    warning: `<svg class="m3-dialog-icon-svg m3-dialog-type-warning" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 5.99L19.53 19H4.47L12 5.99M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z"/></svg>`,
    error: `<svg class="m3-dialog-icon-svg m3-dialog-type-error" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
    question: `<svg class="m3-dialog-icon-svg m3-dialog-type-question" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 16h-2v-2h2v2zm1.07-7.75l-.9.92C12.45 11.9 12 12.5 12 14h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/></svg>`
  };

  function showM3Dialog({ title, message, isConfirm = false, type = 'info' }) {
    return new Promise((resolve) => {
      dialogQueue.push({ title, message, isConfirm, type, resolve });
      processQueue();
    });
  }

  function processQueue() {
    if (isDialogShowing || dialogQueue.length === 0) return;
    isDialogShowing = true;

    const { title, message, isConfirm, type, resolve } = dialogQueue.shift();

    let dialog = document.getElementById('m3-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'm3-dialog';
      dialog.className = 'm3-dialog';
      dialog.innerHTML = `
        <div class="m3-dialog-container">
          <div class="m3-dialog-icon" id="m3-dialog-icon"></div>
          <h3 class="m3-dialog-title" id="m3-dialog-title"></h3>
          <div class="m3-dialog-content" id="m3-dialog-content"></div>
          <div class="m3-dialog-actions">
            <button class="m3-dialog-btn m3-dialog-btn-dismiss" id="m3-dialog-btn-dismiss">取消</button>
            <button class="m3-dialog-btn m3-dialog-btn-confirm" id="m3-dialog-btn-confirm">確定</button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);
    }

    const iconEl = dialog.querySelector('#m3-dialog-icon');
    const titleEl = dialog.querySelector('#m3-dialog-title');
    const contentEl = dialog.querySelector('#m3-dialog-content');
    const dismissBtn = dialog.querySelector('#m3-dialog-btn-dismiss');
    const confirmBtn = dialog.querySelector('#m3-dialog-btn-confirm');

    // Setup icon
    const svgIcon = ICONS[type] || ICONS.info;
    iconEl.innerHTML = svgIcon;
    iconEl.style.display = 'flex';

    // Setup title
    if (title) {
      titleEl.textContent = title;
      titleEl.style.display = 'block';
      dialog.classList.remove('m3-dialog-no-title');
    } else {
      titleEl.style.display = 'none';
      dialog.classList.add('m3-dialog-no-title');
    }

    // Setup content
    contentEl.textContent = message;

    // Setup buttons
    if (isConfirm) {
      dismissBtn.style.display = 'inline-flex';
    } else {
      dismissBtn.style.display = 'none';
    }

    // Handle Escape button or closing from outside
    let resolved = false;
    const cleanUp = (value) => {
      if (resolved) return;
      resolved = true;

      // Add close animation class to start fading out
      dialog.classList.add('m3-dialog-closing');

      const onTransitionEnd = () => {
        dialog.classList.remove('m3-dialog-closing');
        dialog.close();
        
        // Remove keydown handler
        dialog.removeEventListener('keydown', keydownHandler);

        // Remove event handlers by cloning
        const newConfirm = confirmBtn.cloneNode(true);
        const newDismiss = dismissBtn.cloneNode(true);
        confirmBtn.replaceWith(newConfirm);
        dismissBtn.replaceWith(newDismiss);

        resolve(value);

        isDialogShowing = false;
        processQueue();
      };

      // Wait for CSS animation to finish (150ms)
      setTimeout(onTransitionEnd, 150);
    };

    // Keyboard Enter handling
    const keydownHandler = (e) => {
      if (e.key === 'Enter') {
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
          return; // Let standard focus handle Enter
        }
        e.preventDefault();
        dialog.querySelector('#m3-dialog-btn-confirm').click();
      }
    };
    dialog.addEventListener('keydown', keydownHandler);

    // Confirm click
    dialog.querySelector('#m3-dialog-btn-confirm').addEventListener('click', () => {
      cleanUp(true);
    });

    // Dismiss click
    dialog.querySelector('#m3-dialog-btn-dismiss').addEventListener('click', () => {
      cleanUp(false);
    });

    // Handle native dialog close / ESC key
    dialog.oncancel = (e) => {
      e.preventDefault();
      cleanUp(false);
    };

    // Show dialog modal
    dialog.showModal();

    // Auto focus the primary button
    dialog.querySelector('#m3-dialog-btn-confirm').focus();
  }

  // Detect type from message emojis if type is not specified
  function detectTypeFromMessage(message, defaultType) {
    if (message.includes('⚠️')) return 'warning';
    if (message.includes('❌') || message.includes('失敗') || message.includes('錯誤')) return 'error';
    if (message.includes('✅') || message.includes('成功')) return 'success';
    return defaultType;
  }

  // Strip emojis from the message text
  function stripEmojis(message) {
    return message.replace(/^[⚠️❌✅]\s*/, '');
  }

  export function showAlert(message, type = null, title = '') {
    const detectedType = type || detectTypeFromMessage(message, 'info');
    const cleanMessage = stripEmojis(message);
    let defaultTitle = '';
    if (detectedType === 'error') defaultTitle = '發生錯誤';
    else if (detectedType === 'warning') defaultTitle = '系統提示';
    else if (detectedType === 'success') defaultTitle = '執行成功';
    else defaultTitle = '通知';

    return showM3Dialog({
      title: title || defaultTitle,
      message: cleanMessage,
      isConfirm: false,
      type: detectedType
    });
  }

  export function showConfirm(message, type = null, title = '確認操作') {
    const detectedType = type || detectTypeFromMessage(message, 'question');
    const cleanMessage = stripEmojis(message);
    return showM3Dialog({
      title: title,
      message: cleanMessage,
      isConfirm: true,
      type: detectedType
    });
  }
