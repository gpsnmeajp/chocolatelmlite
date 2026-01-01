/**
 * 設定画面のJavaScript
 *
 * このファイルは、ペルソナの設定（表示名、モデル名、システムプロンプト）を
 * 読み込み、編集、保存する機能を提供します。
 */

// 元の設定値を保持する変数（変更検知に使用）
let originalSettings = {};

const keywordKnowledgeState = {
  editingId: null
};

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
  setupPostPromptControls();
  setupKeywordKnowledgeControls();
  await Promise.all([loadSettings(), loadPersonaAssets(), loadGeneralSettings(), loadKeywordKnowledgeEntries(), loadMemoryEntries()]);
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
    const enablePostPromptInput = document.getElementById('enablePostPrompt');
    const postPromptInput = document.getElementById('postPrompt');

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

    if (enablePostPromptInput) {
      enablePostPromptInput.checked = Boolean(data?.enable_post_prompt);
    }

    if (postPromptInput) {
      postPromptInput.value = data?.post_prompt ?? '';
    }

    updatePostPromptState();

    // 変更検知用に元の値を保存
    originalSettings = {
      displayName: displayInput?.value ?? '',
      modelName: modelInput?.value ?? '',
      systemPrompt: systemInput?.value ?? '',
      timerCycle: timerInput?.value ?? '',
      webhookUrl: webhookUrlInput?.value ?? '',
      webhookBody: webhookBodyInput?.value ?? '',
      enablePostPrompt: enablePostPromptInput?.checked ?? false,
      postPrompt: postPromptInput?.value ?? ''
    };
  } catch (error) {
    console.error('Failed to load settings:', error);
    showAlertModal('設定の取得に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
  }
}

function setupPostPromptControls() {
  const toggle = document.getElementById('enablePostPrompt');
  if (!toggle) {
    return;
  }

  toggle.addEventListener('change', () => {
    updatePostPromptState();
  });

  updatePostPromptState();
}

function updatePostPromptState() {
  const toggle = document.getElementById('enablePostPrompt');
  const textarea = document.getElementById('postPrompt');

  if (!toggle || !textarea) {
    return;
  }

  textarea.disabled = !toggle.checked;
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
 * キーワードナレッジのコントロール（ボタン、モーダル）を初期化
 *
 * 追加・保存・更新ボタンのクリックイベントを設定し、
 * モーダルのクリックやキーボード操作も処理します。
 */
function setupKeywordKnowledgeControls() {
  // 各ボタンのDOM要素を取得
  const addBtn = document.getElementById('keywordKnowledgeAdd');
  const saveBtn = document.getElementById('keywordKnowledgeSave');
  const refreshBtn = document.getElementById('keywordKnowledgeRefresh');

  // ボタンのクリックイベントを登録
  addBtn?.addEventListener('click', () => openKeywordKnowledgeEditor());
  saveBtn?.addEventListener('click', () => saveKeywordKnowledgeEntry());
  refreshBtn?.addEventListener('click', () => loadKeywordKnowledgeEntries());

  // モーダルのイベント設定
  const modal = ensureKeywordKnowledgeModal();
  
  // モーダル外をクリックしたら閉じる
  modal.addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    // data-kk-dismiss属性を持つ要素がクリックされた場合
    if (event.target.dataset.kkDismiss !== undefined) {
      closeKeywordKnowledgeEditor();
    }
  });

  // Escapeキーでモーダルを閉じる
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeKeywordKnowledgeEditor();
    }
  });
}

/**
 * キーワードナレッジの編集モーダルを開く
 *
 * @param {object|null} entry - 編集する場合はエントリオブジェクト、新規追加の場合はnull
 *
 * 既存エントリを編集する場合はフィールドに値を設定し、
 * 新規追加の場合は空のフォームを表示します。
 */
function openKeywordKnowledgeEditor(entry = null) {
  // 入力フォームの要素を取得
  const keywordInput = document.getElementById('keywordKnowledgeKeyword');
  const textInput = document.getElementById('keywordKnowledgeText');
  const modal = ensureKeywordKnowledgeModal();
  const title = document.getElementById('keywordKnowledgeModalTitle');

  // 編集中のエントリIDを状態に保存（新規の場合はnull）
  keywordKnowledgeState.editingId = entry?.id ?? null;

  // 入力フィールドに値を設定（新規の場合は空文字）
  if (keywordInput) {
    keywordInput.value = entry?.keyword ?? '';
  }
  if (textInput) {
    textInput.value = entry?.text ?? '';
  }

  // モーダルのタイトルを編集/追加で切り替え
  if (title) {
    title.textContent = keywordKnowledgeState.editingId ? 'キーワードナレッジを編集' : 'キーワードナレッジを追加';
  }

  // モーダルを表示状態にする
  if (modal) {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
  }

  // キーワード入力欄にフォーカスを当てる
  keywordInput?.focus();
}

/**
 * キーワードナレッジの編集モーダルを閉じる
 *
 * モーダルを非表示にし、入力フィールドをクリアします。
 * 編集状態もリセットされます。
 */
function closeKeywordKnowledgeEditor() {
  // 入力フォームの要素を取得
  const keywordInput = document.getElementById('keywordKnowledgeKeyword');
  const textInput = document.getElementById('keywordKnowledgeText');
  const modal = document.getElementById('keywordKnowledgeModal');

  // 編集状態をリセット
  keywordKnowledgeState.editingId = null;

  // 入力フィールドをクリア
  if (keywordInput) {
    keywordInput.value = '';
  }
  if (textInput) {
    textInput.value = '';
  }
  
  // モーダルを非表示にする
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }
}

/**
 * キーワードナレッジのエントリを保存する
 *
 * モーダルで入力された内容をサーバーに送信します。
 * 編集中のIDがある場合は更新、ない場合は新規追加として処理されます。
 */
async function saveKeywordKnowledgeEntry() {
  // 入力フォームとボタンの要素を取得
  const keywordInput = document.getElementById('keywordKnowledgeKeyword');
  const textInput = document.getElementById('keywordKnowledgeText');
  const saveBtn = document.getElementById('keywordKnowledgeSave');

  // 入力値を取得（前後の空白を削除）
  const keyword = (keywordInput?.value ?? '').trim();
  const text = (textInput?.value ?? '').trim();

  // キーワードが空の場合はエラー表示
  if (!keyword) {
    showAlertModal('キーワードを入力してください。', { title: 'エラー' });
    keywordInput?.focus();
    return;
  }

  // サーバーに送信するデータを作成
  const payload = { keyword, text };
  // 編集中のIDがあれば追加（更新の場合）
  if (keywordKnowledgeState.editingId) {
    payload.id = keywordKnowledgeState.editingId;
  }

  try {
    // 二重送信を防ぐため保存ボタンを無効化
    if (saveBtn) {
      saveBtn.disabled = true;
    }

    // サーバーに保存リクエストを送信
    const data = await fetchJson('/api/persona/active/keyword-knowledge', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // エラーレスポンスの確認
    if (data && data.error) {
      throw new Error(data.error);
    }

    // 保存成功：モーダルを閉じて一覧を再読み込み
    closeKeywordKnowledgeEditor();
    await loadKeywordKnowledgeEntries();
  } catch (error) {
    console.error('Failed to save keyword knowledge entry:', error);
    showAlertModal('キーワードナレッジの保存に失敗しました。時間をおいて再度お試しください。', { title: 'エラー' });
  } finally {
    // 処理完了後、保存ボタンを再度有効化
    if (saveBtn) {
      saveBtn.disabled = false;
    }
  }
}

/**
 * キーワードナレッジモーダルのDOM要素を取得する
 *
 * @returns {HTMLElement} モーダル要素
 * @throws {Error} モーダル要素が見つからない場合
 *
 * モーダル要素の存在を確認し、取得します。
 * 要素が存在しない場合はエラーをスローします。
 */
function ensureKeywordKnowledgeModal() {
  let modal = document.getElementById('keywordKnowledgeModal');
  if (!modal) {
    throw new Error('Keyword Knowledge Modal element not found.');
  }
  return modal;
}

/**
 * キーワードナレッジのエントリ一覧をサーバーから読み込む
 *
 * サーバーからキーワードナレッジのデータを取得し、
 * 画面に表示します。読み込み中やエラー時の状態表示も制御します。
 */
async function loadKeywordKnowledgeEntries() {
  // 各UI要素を取得
  const itemsContainer = document.getElementById('keywordKnowledgeItems');
  const loadingIndicator = document.getElementById('keywordKnowledgeLoading');
  const errorState = document.getElementById('keywordKnowledgeError');
  const countLabel = document.getElementById('keywordKnowledgeCount');

  // コンテナが存在しない場合は処理を中断
  if (!itemsContainer) {
    return;
  }

  // 読み込み中の表示を開始し、エラー表示を非表示
  if (loadingIndicator) {
    loadingIndicator.hidden = false;
  }
  if (errorState) {
    errorState.hidden = true;
  }

  try {
    // サーバーからデータを取得
    const data = await fetchJson('/api/persona/active/keyword-knowledge');
    const entries = Array.isArray(data?.keyword_knowledge_entries) ? data.keyword_knowledge_entries : [];

    // 件数ラベルを更新
    if (countLabel) {
      countLabel.textContent = `${entries.length}件`;
      countLabel.hidden = false;
    }

    // エントリ一覧を画面に描画
    renderKeywordKnowledgeEntries(entries);
  } catch (error) {
    console.error('Failed to load keyword knowledge entries:', error);
    // エラー発生時はエラー表示を表示
    if (errorState) {
      errorState.hidden = false;
    }
    // 空の状態表示は非表示に
    const empty = document.getElementById('keywordKnowledgeEmpty');
    if (empty) {
      empty.hidden = true;
    }
  } finally {
    // 読み込み完了後、読み込み中表示を非表示
    if (loadingIndicator) {
      loadingIndicator.hidden = true;
    }
  }
}

/**
 * キーワードナレッジのエントリ一覧を画面に描画する
 *
 * @param {Array} entries - キーワードナレッジのエントリ配列
 *
 * エントリが空の場合は空の状態メッセージを表示し、
 * エントリがある場合は各エントリをリスト表示します。
 */
function renderKeywordKnowledgeEntries(entries) {
  // コンテナと空の状態表示の要素を取得
  const itemsContainer = document.getElementById('keywordKnowledgeItems');
  const emptyState = document.getElementById('keywordKnowledgeEmpty');

  if (!itemsContainer) {
    return;
  }

  // 既存のコンテンツをクリア
  itemsContainer.innerHTML = '';

  // エントリが空の場合は空の状態メッセージを表示
  if (!entries || !entries.length) {
    if (emptyState) {
      emptyState.hidden = false;
    }
    return;
  }

  // エントリがある場合は空の状態メッセージを非表示
  if (emptyState) {
    emptyState.hidden = true;
  }

  // DocumentFragmentを使用してパフォーマンスを最適化
  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
    const element = createKeywordKnowledgeElement(entry);
    if (element) {
      fragment.appendChild(element);
    }
  });

  // 一度にDOMに追加
  itemsContainer.appendChild(fragment);
}

/**
 * キーワードナレッジのエントリ要素（HTML）を生成する
 *
 * @param {object} entry - キーワードナレッジのエントリデータ
 * @returns {HTMLElement|null} 生成されたエントリ要素、または不正なデータの場合はnull
 *
 * 各エントリに対して、キーワード、内容、編集ボタン、削除ボタンを含む
 * HTML要素を動的に生成します。
 */
function createKeywordKnowledgeElement(entry) {
  // エントリデータを正規化（型チェック・デフォルト値設定）
  const normalized = normalizeKeywordKnowledgeEntry(entry);
  if (!normalized) {
    return null;
  }

  // エントリ全体のラッパー要素
  const wrapper = document.createElement('div');
  wrapper.className = 'knowledge-item';

  // ヘッダー部分（キーワードとアクションボタン）
  const head = document.createElement('div');
  head.className = 'knowledge-item-head';

  // キーワード表示部分
  const keyword = document.createElement('div');
  keyword.className = 'knowledge-item-keyword';
  keyword.textContent = '✏️' + (normalized.keyword || '(キーワード未設定)');

  // アクションボタンのコンテナ
  const actions = document.createElement('div');
  actions.className = 'knowledge-item-actions';

  // 編集ボタン
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-secondary';
  editBtn.textContent = '編集';
  editBtn.addEventListener('click', () => openKeywordKnowledgeEditor(normalized));

  // 削除ボタン
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-danger';
  deleteBtn.textContent = '削除';
  deleteBtn.addEventListener('click', () => deleteKeywordKnowledgeEntry(normalized.id));

  // ボタンをアクションコンテナに追加
  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  // ヘッダーに要素を追加
  head.appendChild(keyword);
  head.appendChild(actions);

  // 本文部分（キーワードの内容テキスト）
  const body = document.createElement('div');
  body.className = 'knowledge-item-text';
  body.textContent = normalized.text || '（内容なし）';

  // ラッパーに全要素を追加
  wrapper.appendChild(head);
  wrapper.appendChild(body);

  return wrapper;
}

/**
 * キーワードナレッジのエントリデータを正規化する
 *
 * @param {object} entry - サーバーから取得した生のエントリデータ
 * @returns {object|null} 正規化されたエントリデータ、または不正なデータの場合はnull
 *
 * サーバーから取得したデータのプロパティ名の揺れ（大文字/小文字）を吸収し、
 * 型変換やデフォルト値の設定を行います。
 */
function normalizeKeywordKnowledgeEntry(entry) {
  // データが存在しない、またはオブジェクトでない場合はnullを返す
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  // プロパティ名の大文字小文字の違いを吸収して値を取得
  const id = Number(entry.Id ?? entry.id ?? 0);
  const keyword = String(entry.Keyword ?? entry.keyword ?? '').trim();
  const text = String(entry.Text ?? entry.text ?? '');

  // 正規化されたオブジェクトを返す
  return {
    id: Number.isFinite(id) ? id : 0,
    keyword,
    text
  };
}

/**
 * キーワードナレッジのエントリを削除する
 *
 * @param {number} id - 削除するエントリのID
 *
 * ユーザーに確認ダイアログを表示し、確認後にサーバーに削除リクエストを送信します。
 * 削除成功後は一覧を再読み込みします。
 */
async function deleteKeywordKnowledgeEntry(id) {
  // IDが不正な場合は処理を中断
  if (!Number.isFinite(id) || id <= 0) {
    return;
  }

  // ユーザーに削除確認ダイアログを表示
  const confirmed = await showConfirmModal('このキーワードナレッジを削除しますか？', {
    title: '削除の確認',
    confirmLabel: '削除',
    cancelLabel: 'キャンセル',
    variant: 'danger'
  });

  // キャンセルされた場合は処理を中断
  if (!confirmed) {
    return;
  }

  try {
    // サーバーに削除リクエストを送信
    const data = await fetchJson(`/api/persona/active/keyword-knowledge/${id}`, {
      method: 'DELETE'
    });

    // エラーレスポンスの確認
    if (data && data.error) {
      throw new Error(data.error);
    }

    // 削除成功：モーダルを閉じて一覧を再読み込み
    closeKeywordKnowledgeEditor();
    await loadKeywordKnowledgeEntries();
  } catch (error) {
    console.error('Failed to delete keyword knowledge entry:', error);
    showAlertModal('キーワードナレッジの削除に失敗しました。時間をおいて再度お試しください。', { title: 'エラー' });
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
  payload.enable_post_prompt = document.getElementById('enablePostPrompt')?.checked ?? false;
  payload.post_prompt = document.getElementById('postPrompt')?.value ?? '';

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
      webhookBody: payload.webhook_body,
      enablePostPrompt: payload.enable_post_prompt,
      postPrompt: payload.post_prompt
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
  const enablePostPromptInput = document.getElementById('enablePostPrompt');
  const postPromptInput = document.getElementById('postPrompt');

  // 変更があるかどうかをチェック
  const hasChanges =
    (displayInput?.value ?? '') !== originalSettings.displayName ||
    (modelInput?.value ?? '') !== originalSettings.modelName ||
    (systemInput?.value ?? '') !== originalSettings.systemPrompt ||
    (timerInput?.value ?? '') !== originalSettings.timerCycle ||
    (webhookUrlInput?.value ?? '') !== originalSettings.webhookUrl ||
    (webhookBodyInput?.value ?? '') !== originalSettings.webhookBody ||
    (enablePostPromptInput?.checked ?? false) !== originalSettings.enablePostPrompt ||
    (postPromptInput?.value ?? '') !== originalSettings.postPrompt ||
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
