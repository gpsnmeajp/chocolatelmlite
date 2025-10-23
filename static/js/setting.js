/**
 * 設定画面のJavaScript
 *
 * このファイルは、ペルソナの設定（表示名、モデル名、システムプロンプト）を
 * 読み込み、編集、保存する機能を提供します。
 */

// 元の設定値を保持する変数（変更検知に使用）
let originalSettings = {};

// アップロード対象の資産設定
const assetConfig = [
  { key: 'user', filename: 'user.png', label: 'ユーザーアイコン' },
  { key: 'assistant', filename: 'assistant.png', label: 'アシスタントアイコン' },
  { key: 'background', filename: 'background.png', label: '背景画像' }
];

// 資産ごとの選択状態
const assetState = assetConfig.reduce((acc, entry) => {
  acc[entry.key] = { dirty: false, file: null, objectUrl: null };
  return acc;
}, {});

/**
 * 初期化関数
 * ページ読み込み時に設定を読み込む
 */
async function init() {
  setupAssetHandlers();
  await Promise.all([loadSettings(), loadPersonaAssets(), loadGeneralSettings(), loadMemoryEntries()]);
}

/**
 * アクティブなペルソナの設定を読み込んでフォームに表示
 *
 * サーバーから現在アクティブなペルソナの設定を取得し、
 * 各入力フィールドに値を設定します。
 * また、変更検知のために元の設定値を保存します。
 */
async function loadSettings() {
  try {
    // サーバーから設定を取得
    const data = await fetchJson('/api/persona/active/setting');
    const displayInput = document.getElementById('displayName');
    const modelInput = document.getElementById('modelName');
    const systemInput = document.getElementById('systemPrompt');
    const timerInput = document.getElementById('timerCycle');
    const webhookUrlInput = document.getElementById('webhookUrl');
    const webhookBodyInput = document.getElementById('webhookBody');

    // 各フィールドに値を設定
    if (displayInput) {
      displayInput.value = data?.name ?? '';
    }
    if (modelInput) {
      modelInput.value = data?.model ?? '';
    }
    if (systemInput) {
      systemInput.value = data?.system_prompt ?? '';
    }
    if (timerInput) {
      // MEMO: ちょっとオーバーな気がする。もっとシンプルでいいのでは。
      const rawTimer = data?.timer_cycle_minutes;
      let timerValue = 0;
      if (typeof rawTimer === 'number' && Number.isFinite(rawTimer)) {
        timerValue = rawTimer;
      } else if (typeof rawTimer === 'string') {
        const parsed = Number.parseInt(rawTimer, 10);
        if (Number.isFinite(parsed)) {
          timerValue = parsed;
        }
      }
      timerInput.value = String(Math.max(0, timerValue));
    }
    if (webhookUrlInput) {
      webhookUrlInput.value = data?.webhook_url ?? '';
    }
    if (webhookBodyInput) {
      webhookBodyInput.value = data?.webhook_body ?? '';
    }

    // 変更検知用に元の値を保存
    originalSettings = {
      displayName: displayInput?.value ?? '',
      modelName: modelInput?.value ?? '',
      systemPrompt: systemInput?.value ?? '',
      timerCycle: timerInput?.value ?? '',
      webhookUrl: webhookUrlInput?.value ?? '',
      webhookBody: webhookBodyInput?.value ?? ''
    };
  } catch (error) {
    console.error('Failed to load settings:', error);
    showAlertModal('設定の取得に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
  }
}

/**
 * ペルソナ資産（アイコン・背景画像）を読み込む
 */
async function loadPersonaAssets() {
  await Promise.all(assetConfig.map(loadPersonaAsset));
}

/**
 * 一般設定を取得して参考情報ラベルに反映
 */
async function loadGeneralSettings() {
  try {
    const data = await fetchJson('/api/setting');
    const endpoint = data?.settings?.LlmEndpointUrl?.trim?.() || '';
    const defaultModel = data?.settings?.DefaultModel?.trim?.() || '';

    const endpointLabel = document.getElementById('generalEndpointLabel');
    if (endpointLabel) {
      if (endpoint) {
        endpointLabel.textContent = `接続先: ${endpoint}`;
        endpointLabel.hidden = false;
      } else {
        endpointLabel.hidden = true;
      }
    }

    const modelLabel = document.getElementById('generalDefaultModelLabel');
    if (modelLabel) {
      if (defaultModel) {
        modelLabel.textContent = `既定のモデル: ${defaultModel}`;
        modelLabel.hidden = false;
      } else {
        modelLabel.hidden = true;
      }
    }
  } catch (error) {
    console.error('Failed to load general settings:', error);
  }
}

/**
 * メモリ一覧を読み込む
 */
async function loadMemoryEntries() {
  const itemsContainer = document.getElementById('memoryItems');
  const loadingIndicator = document.getElementById('memoryLoading');
  const emptyState = document.getElementById('memoryEmpty');
  const errorState = document.getElementById('memoryError');
  const countLabel = document.getElementById('memoryCount');

  if (!itemsContainer) {
    return;
  }

  if (loadingIndicator) {
    loadingIndicator.hidden = false;
  }
  if (errorState) {
    errorState.hidden = true;
  }

  try {
    const data = await fetchJson('/api/persona/active/memory');
    const entries = Array.isArray(data?.memory_entries) ? data.memory_entries : [];

    if (countLabel) {
      countLabel.textContent = `${entries.length}件`;
      countLabel.hidden = false;
    }

    itemsContainer.innerHTML = '';

    if (!entries.length) {
      if (emptyState) {
        emptyState.hidden = false;
      }
      return;
    }

    if (emptyState) {
      emptyState.hidden = true;
    }

    const fragment = document.createDocumentFragment();
    entries.forEach((entry) => {
      const element = createMemoryEntryElement(entry);
      if (element) {
        fragment.appendChild(element);
      }
    });
    itemsContainer.appendChild(fragment);
  } catch (error) {
    console.error('Failed to load memory entries:', error);
    if (errorState) {
      errorState.hidden = false;
    }
    if (emptyState) {
      emptyState.hidden = true;
    }
  } finally {
    if (loadingIndicator) {
      loadingIndicator.hidden = true;
    }
  }
}

/**
 * メモリエントリ要素を生成
 * @param {Record<string, unknown>} entry
 * @returns {HTMLElement | null}
 */
function createMemoryEntryElement(entry) {
  const normalized = normalizeMemoryEntry(entry);
  if (!normalized) {
    return null;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'memory-entry';

  const meta = document.createElement('div');
  meta.className = 'memory-entry-meta';

  const indexEl = document.createElement('span');
  indexEl.className = 'memory-entry-index';
  indexEl.textContent = `#${normalized.id}`;
  meta.appendChild(indexEl);

  const timestampText = buildMemoryTimestampLabel(normalized.createdAt, normalized.updatedAt);
  if (timestampText) {
    const timestampEl = document.createElement('span');
    timestampEl.className = 'memory-entry-timestamp';
    timestampEl.textContent = timestampText;
    meta.appendChild(timestampEl);
  }

  const textEl = document.createElement('div');
  textEl.className = 'memory-entry-text';
  textEl.textContent = normalized.text;

  wrapper.appendChild(meta);
  wrapper.appendChild(textEl);
  return wrapper;
}

/**
 * メモリエントリを正規化
 * @param {Record<string, unknown>} entry
 * @returns {{ id: number, text: string, createdAt: string, updatedAt: string } | null}
 */
function normalizeMemoryEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = Number(entry.Id ?? entry.id ?? 0);
  const text = String(entry.Text ?? entry.text ?? '');
  const createdAt = String(entry.CreatedAt ?? entry.createdAt ?? '');
  const updatedAt = String(entry.UpdatedAt ?? entry.updatedAt ?? '');

  return {
    id: Number.isFinite(id) ? id : 0,
    text,
    createdAt,
    updatedAt
  };
}

/**
 * タイムスタンプラベルを構築
 * @param {string} createdAt
 * @param {string} updatedAt
 * @returns {string}
 */
function buildMemoryTimestampLabel(createdAt, updatedAt) {
  const parts = [];
  if (createdAt) {
    parts.push(`作成: ${createdAt}`);
  }
  if (updatedAt && updatedAt !== createdAt) {
    parts.push(`更新: ${updatedAt}`);
  }
  return parts.join(' / ');
}

/**
 * 特定の資産を読み込んでプレビューを更新
 * @param {{ key: string, filename: string }} config
 */
async function loadPersonaAsset(config) {
  const state = assetState[config.key];
  if (!state) {
    return;
  }

  try {
    const response = await fetch(`/api/persona/active/${config.filename}?ts=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      clearAssetPreview(config.key);
      state.dirty = false;
      state.file = null;
      return;
    }

    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.startsWith('image/')) {
      clearAssetPreview(config.key);
      state.dirty = false;
      state.file = null;
      return;
    }

    const blob = await response.blob();
    setAssetPreview(config.key, blob);
    state.dirty = false;
    state.file = null;
  } catch (error) {
    console.warn(`Failed to load asset: ${config.filename}`, error);
    clearAssetPreview(config.key);
    state.dirty = false;
    state.file = null;
  }
}

/**
 * 資産アップロード用のイベントハンドラーを設定
 */
function setupAssetHandlers() {
  const selectButtons = document.querySelectorAll('[data-asset-select]');
  selectButtons.forEach((button) => {
    const type = button.getAttribute('data-asset-select');
    button.addEventListener('click', () => {
      const input = document.querySelector(`[data-asset-input="${type}"]`);
      if (input) {
        input.click();
      }
    });
  });

  const inputs = document.querySelectorAll('[data-asset-input]');
  inputs.forEach((input) => {
    const type = input.getAttribute('data-asset-input');
    input.addEventListener('change', (event) => {
      const target = event.target;
      const file = target.files && target.files[0];
      if (file) {
        handleAssetFileSelection(type, file);
      }

      // 同じファイルを再選択できるように値をリセット
      target.value = '';
    });
  });
}

/**
 * 資産選択時の処理
 * @param {string} type
 * @param {File} file
 */
function handleAssetFileSelection(type, file) {
  const state = assetState[type];
  if (!state) {
    return;
  }

  setAssetPreview(type, file);
  state.file = file;
  state.dirty = true;
}

/**
 * プレビューをセットする
 * @param {string} type
 * @param {Blob} blob
 */
function setAssetPreview(type, blob) {
  const state = assetState[type];
  const img = document.querySelector(`[data-asset-preview="${type}"]`);
  const placeholder = document.querySelector(`[data-asset-placeholder="${type}"]`);

  if (!state || !img || !placeholder) {
    return;
  }

  releaseAssetUrl(type);

  if (!blob) {
    clearAssetPreview(type);
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  state.objectUrl = objectUrl;
  img.src = objectUrl;
  img.style.display = 'block';
  placeholder.hidden = true;
}

/**
 * プレビューをクリアする
 * @param {string} type
 */
function clearAssetPreview(type) {
  const state = assetState[type];
  const img = document.querySelector(`[data-asset-preview="${type}"]`);
  const placeholder = document.querySelector(`[data-asset-placeholder="${type}"]`);

  if (!state || !img || !placeholder) {
    return;
  }

  releaseAssetUrl(type);
  img.removeAttribute('src');
  img.style.display = 'none';
  placeholder.hidden = false;
  state.file = null;
  state.dirty = false;
}

/**
 * ObjectURLを破棄する
 * @param {string} type
 */
function releaseAssetUrl(type) {
  const state = assetState[type];
  if (state && state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
}

/**
 * 未保存の資産変更があるか確認
 * @returns {boolean}
 */
function hasUnsavedAssetChanges() {
  return assetConfig.some((entry) => assetState[entry.key]?.dirty);
}

/**
 * 選択された資産をアップロード
 */
async function uploadAssetChanges() {
  for (const entry of assetConfig) {
    const state = assetState[entry.key];
    if (!state?.dirty || !state.file) {
      continue;
    }

    const response = await fetch(`/api/persona/active/${entry.filename}`, {
      method: 'POST',
      headers: {
        'Content-Type': state.file.type || 'application/octet-stream'
      },
      body: state.file
    });

    const contentType = response.headers.get('Content-Type') || '';
    const responseText = await response.text();

    let json = null;
    if (contentType.includes('application/json') && responseText) {
      try {
        json = JSON.parse(responseText);
      } catch (error) {
        console.warn('Failed to parse upload response JSON.', error);
      }
    }

    if (!response.ok) {
      const message = json?.error || responseText || `${entry.label}のアップロードに失敗しました。`;
      throw new Error(message);
    }

    if (json && json.error) {
      throw new Error(json.error);
    }

    state.dirty = false;
    state.file = null;

    // サーバーで変換された最新の画像を取得してプレビューを更新
    await loadPersonaAsset(entry);
  }
}

window.addEventListener('beforeunload', () => {
  assetConfig.forEach((entry) => releaseAssetUrl(entry.key));
});

/**
 * 設定を保存する
 *
 * フォームの入力内容をサーバーに送信して保存します。
 * 保存が成功したら、トーク画面に遷移します。
 */
async function saveSettings() {
  const saveButton = document.querySelector('.header-content .btn-primary');

  // 送信するデータを作成
  const payload = {
    name: document.getElementById('displayName')?.value ?? '',
    model: document.getElementById('modelName')?.value ?? '',
    system_prompt: document.getElementById('systemPrompt')?.value ?? ''
  };

  const timerInput = document.getElementById('timerCycle');
  const parsedTimer = Number.parseInt(timerInput?.value ?? '', 10);
  const timerCycleMinutes = Number.isFinite(parsedTimer) && parsedTimer >= 0 ? parsedTimer : 0;
  payload.timer_cycle_minutes = timerCycleMinutes;
  payload.webhook_url = document.getElementById('webhookUrl')?.value ?? '';
  payload.webhook_body = document.getElementById('webhookBody')?.value ?? '';

  try {
    // 二重送信を防ぐため、ボタンを無効化
    if (saveButton) {
      saveButton.disabled = true;
    }

    await uploadAssetChanges();

    // サーバーに設定を送信
    const data = await fetchJson('/api/persona/active/setting', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // エラーレスポンスの確認
    if (data && data.error) {
      throw new Error(data.error);
    }

    // 保存した値を元の設定値として更新
    originalSettings = {
      displayName: payload.name,
      modelName: payload.model,
      systemPrompt: payload.system_prompt,
      timerCycle: String(timerCycleMinutes),
      webhookUrl: payload.webhook_url,
      webhookBody: payload.webhook_body
    };

    // トーク画面に遷移
    window.location.href = 'talk.htm';
  } catch (error) {
    console.error('Failed to save settings:', error);
    showAlertModal('設定の保存に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
  } finally {
    // ボタンを再度有効化
    if (saveButton) {
      saveButton.disabled = false;
    }
  }
}

/**
 * トーク画面に戻る
 *
 * 設定に変更がある場合は確認ダイアログを表示します。
 * ユーザーが確認した場合、またはそもそも変更がない場合はトーク画面に遷移します。
 */
function goBack() {
  const displayInput = document.getElementById('displayName');
  const modelInput = document.getElementById('modelName');
  const systemInput = document.getElementById('systemPrompt');
  const timerInput = document.getElementById('timerCycle');
  const webhookUrlInput = document.getElementById('webhookUrl');
  const webhookBodyInput = document.getElementById('webhookBody');

  // 変更があるかどうかをチェック
  const hasChanges =
    (displayInput?.value ?? '') !== originalSettings.displayName ||
    (modelInput?.value ?? '') !== originalSettings.modelName ||
    (systemInput?.value ?? '') !== originalSettings.systemPrompt ||
    (timerInput?.value ?? '') !== originalSettings.timerCycle ||
    (webhookUrlInput?.value ?? '') !== originalSettings.webhookUrl ||
    (webhookBodyInput?.value ?? '') !== originalSettings.webhookBody ||
    hasUnsavedAssetChanges();

  // 変更がある場合は確認ダイアログを表示
  if (hasChanges && !confirm('変更が保存されていません。破棄して戻りますか?')) {
    return;
  }

  // トーク画面に遷移
  window.location.href = 'talk.htm';
}

// ページ読み込み時に初期化を実行
document.addEventListener('DOMContentLoaded', init);
