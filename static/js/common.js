/**
 * JSON形式のデータをfetchするユーティリティ関数
 *
 * この関数は、指定されたURLに対してHTTPリクエストを送信し、JSONレスポンスを取得します。
 * Content-Typeヘッダーの自動設定、エラーハンドリング、レスポンスの型チェックを行います。
 *
 * @param {string} url - リクエスト先のURL
 * @param {Object} options - fetchに渡すオプション（method, headers, bodyなど）
 * @returns {Promise<Object|null>} - JSONオブジェクト、またはJSON以外のレスポンスの場合はnull
 * @throws {Error} - HTTPステータスがエラーの場合、またはネットワークエラーが発生した場合
 *
 * @example
 * // GETリクエスト
 * const data = await fetchJson('/api/user');
 *
 * @example
 * // POSTリクエスト
 * const result = await fetchJson('/api/user', {
 *   method: 'POST',
 *   body: JSON.stringify({ name: 'John' })
 * });
 */
async function fetchJson(url, options = {}) {
  // オプションをコピーして元のオブジェクトを変更しないようにする
  const opts = { ...options };
  opts.headers = { ...(opts.headers || {}) };

  // FormDataの場合はContent-Typeを自動設定させるため、明示的に設定しない
  const isFormData = opts.body instanceof FormData;
  if (opts.body && !isFormData && !opts.headers['Content-Type']) {
    opts.headers['Content-Type'] = 'application/json';
  }

  // HTTPリクエストを実行
  const response = await fetch(url, opts);

  // レスポンスステータスがエラーの場合は例外をスロー
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'サーバーエラーが発生しました');
  }

  // レスポンスのContent-Typeを確認
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // JSON以外のレスポンスの場合はnullを返す
    return null;
  }

  // JSONとしてパースして返す
  return response.json();
}

let appAlertModalLastActiveElement = null;
let appConfirmModalLastActiveElement = null;

function showConfirmModal(message, options = {}) {
  const {
    title = '確認',
    confirmLabel = 'OK',
    cancelLabel = 'キャンセル',
    variant = 'primary'
  } = options;

  const modal = ensureConfirmModal();
  const titleElem = modal.querySelector('.app-modal-title');
  const bodyElem = modal.querySelector('.app-modal-body');
  const confirmBtn = modal.querySelector('[data-app-modal-confirm]');
  const cancelBtn = modal.querySelector('[data-app-modal-cancel]');
  const backdrop = modal.querySelector('[data-app-modal-dismiss]');

  if (titleElem) {
    titleElem.textContent = title;
  }

  if (bodyElem) {
    bodyElem.innerHTML = message;
  }

  if (confirmBtn) {
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.remove('btn-primary', 'btn-danger', 'btn-secondary');
    confirmBtn.classList.add(variant === 'danger' ? 'btn-danger' : 'btn-primary');
  }

  if (cancelBtn) {
    cancelBtn.textContent = cancelLabel;
    cancelBtn.classList.remove('btn-primary', 'btn-danger');
    cancelBtn.classList.add('btn-secondary');
  }

  appConfirmModalLastActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');

  return new Promise(resolve => {
    const cleanup = result => {
      if (confirmBtn) {
        confirmBtn.removeEventListener('click', handleConfirm);
      }
      if (cancelBtn) {
        cancelBtn.removeEventListener('click', handleCancel);
      }
      if (backdrop) {
        backdrop.removeEventListener('click', handleBackdrop);
      }
      modal.removeEventListener('keydown', handleKeyDown);
      hideConfirmModal();
      resolve(result);
    };

    const handleConfirm = () => cleanup(true);
    const handleCancel = () => cleanup(false);
    const handleBackdrop = event => {
      if (event.target === backdrop) {
        cleanup(false);
      }
    };
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(false);
      }
    };

    if (confirmBtn) {
      confirmBtn.addEventListener('click', handleConfirm);
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', handleCancel);
    }
    if (backdrop) {
      backdrop.addEventListener('click', handleBackdrop);
    }
    modal.addEventListener('keydown', handleKeyDown);

    requestAnimationFrame(() => {
      confirmBtn?.focus();
    });
  });
}

function hideConfirmModal() {
  const modal = document.getElementById('confirmModal');
  if (!modal) {
    return;
  }

  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');

  if (appConfirmModalLastActiveElement) {
    appConfirmModalLastActiveElement.focus();
    appConfirmModalLastActiveElement = null;
  }
}

function showAlertModal(message, options = {}) {
  const { title = '通知', confirmLabel = '閉じる' } = options;
  const modal = ensureAlertModal();
  const titleElem = modal.querySelector('.app-modal-title');
  const bodyElem = modal.querySelector('.app-modal-body');
  const closeBtn = modal.querySelector('.app-modal-close');

  if (titleElem) {
    titleElem.textContent = title;
  }

  if (bodyElem) {
    bodyElem.innerHTML = message;
  }

  if (closeBtn) {
    closeBtn.textContent = confirmLabel;
  }

  appAlertModalLastActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => {
    if (closeBtn) {
      closeBtn.focus();
    }
  });
}

function hideAlertModal() {
  const modal = document.getElementById('alertModal');
  if (!modal) {
    return;
  }

  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');

  if (appAlertModalLastActiveElement) {
    appAlertModalLastActiveElement.focus();
    appAlertModalLastActiveElement = null;
  }
}

function ensureAlertModal() {
  let modal = document.getElementById('alertModal');
  if (modal) {
    return modal;
  }

  modal = document.createElement('div');
  modal.id = 'alertModal';
  modal.className = 'app-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'alertModalTitle');

  modal.innerHTML = `
    <div class="app-modal-backdrop" data-app-modal-close></div>
    <div class="app-modal-content">
      <h2 class="app-modal-title" id="alertModalTitle"></h2>
      <div class="app-modal-body"></div>
      <div class="app-modal-actions">
        <button class="app-modal-close" type="button" data-app-modal-close>閉じる</button>
      </div>
    </div>
  `;

  modal.addEventListener('click', event => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    if (event.target.matches('[data-app-modal-close]')) {
      hideAlertModal();
    }
  });

  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideAlertModal();
    }
  });

  document.body.appendChild(modal);
  return modal;
}

function ensureConfirmModal() {
  let modal = document.getElementById('confirmModal');
  if (modal) {
    return modal;
  }

  modal = document.createElement('div');
  modal.id = 'confirmModal';
  modal.className = 'app-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'confirmModalTitle');
  modal.setAttribute('tabindex', '-1');

  modal.innerHTML = `
    <div class="app-modal-backdrop" data-app-modal-dismiss></div>
    <div class="app-modal-content">
      <h2 class="app-modal-title" id="confirmModalTitle"></h2>
      <div class="app-modal-body" id="confirmModalBody"></div>
      <div class="app-modal-actions">
        <button type="button" class="btn-secondary" data-app-modal-cancel>キャンセル</button>
        <button type="button" class="btn-primary" data-app-modal-confirm>OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}
