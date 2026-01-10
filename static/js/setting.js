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

let desiredVoicevoxSpeakerId = null;

function parseNumberInput(value, { allowNegative = false, integer = false } = {}) {
  const text = (value ?? '').toString().trim();
  if (!text) {
    return null;
  }

  const parsed = integer ? Number.parseInt(text, 10) : Number(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (!allowNegative && parsed < 0) {
    return null;
  }

  return parsed;
}

function normalizeNumberForInput(value, options) {
  if (value === null || value === undefined) {
    return '';
  }

  const parsed = parseNumberInput(value, options);
  return parsed === null ? '' : String(parsed);
}

function setVoicevoxSpeakerSelection(speakerId) {
  const parsed = parseNumberInput(speakerId, { allowNegative: true, integer: true });
  desiredVoicevoxSpeakerId = Number.isFinite(parsed) ? parsed : null;
  applyVoicevoxSpeakerSelection();
}

function applyVoicevoxSpeakerSelection() {
  const select = document.getElementById('voicevoxSpeakerId');
  if (!select) {
    return;
  }

  const targetValue = desiredVoicevoxSpeakerId === null ? '' : String(desiredVoicevoxSpeakerId);
  select.value = targetValue;

  if (targetValue && select.value !== targetValue) {
    const exists = Array.from(select.options).some((option) => option.value === targetValue);
    if (!exists) {
      const fallbackOption = document.createElement('option');
      fallbackOption.value = targetValue;
      fallbackOption.textContent = `ID ${targetValue} (未取得)`;
      select.appendChild(fallbackOption);
    }
    select.value = targetValue;
  }
}

/**
 * 初期化関数
 * ページ読み込み時に設定を読み込む
 */
async function init() {
  setupAssetHandlers();
  setupPostPromptControls();
  setupDynamicContextControls();
  setupKeywordKnowledgeControls();
  await Promise.all([loadSettings(), loadPersonaAssets(), loadGeneralSettings(), loadKeywordKnowledgeEntries(), loadMemoryEntries(), loadVoicevoxSpeakers()]);
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
    const postProcessScriptInput = document.getElementById('postProcessScript');
    const enableDynamicContextInput = document.getElementById('enableDynamicContext');
    const dynamicContextUrlInput = document.getElementById('dynamicContextUrl');
    const dynamicContextHistoryTurnsInput = document.getElementById('dynamicContextHistoryTurns');
    const talkHistoryCutoffHoursInput = document.getElementById('talkHistoryCutoffHours');
    const removeAttachmentInput = document.getElementById('removeAttachment');
    const voicevoxSpeakerIdInput = document.getElementById('voicevoxSpeakerId');
    const voicevoxExtractModeInput = document.getElementById('voicevoxExtractMode');
    const voicevoxSpeedScaleInput = document.getElementById('voicevoxSpeedScale');
    const voicevoxPitchScaleInput = document.getElementById('voicevoxPitchScale');
    const voicevoxIntonationScaleInput = document.getElementById('voicevoxIntonationScale');
    const voicevoxVolumeScaleInput = document.getElementById('voicevoxVolumeScale');
    const voicevoxPrePhonemeLengthInput = document.getElementById('voicevoxPrePhonemeLength');
    const voicevoxPostPhonemeLengthInput = document.getElementById('voicevoxPostPhonemeLength');
    const voicevoxPauseLengthInput = document.getElementById('voicevoxPauseLength');
    const voicevoxPauseLengthScaleInput = document.getElementById('voicevoxPauseLengthScale');
    const voicevoxSyncTextPrintingInput = document.getElementById('voicevoxSyncTextPrinting');

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

    if (postProcessScriptInput) {
      postProcessScriptInput.value = data?.post_process_script ?? '';
    }

    if (enableDynamicContextInput) {
      enableDynamicContextInput.checked = Boolean(data?.enable_dynamic_context);
    }

    if (dynamicContextUrlInput) {
      dynamicContextUrlInput.value = data?.dynamic_context_url ?? '';
    }

    if (dynamicContextHistoryTurnsInput) {
      const raw = data?.dynamic_context_history_turns;
      const parsed = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.parseInt(raw, 10);
      dynamicContextHistoryTurnsInput.value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 8;
    }

    if (talkHistoryCutoffHoursInput) {
      const raw = data?.talk_history_cutoff_by_past_hours;
      const parsed = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.parseInt(raw, 10);
      talkHistoryCutoffHoursInput.value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }

    if (removeAttachmentInput) {
      removeAttachmentInput.checked = Boolean(data?.remove_attachment);
    }

    setVoicevoxSpeakerSelection(data?.voicevox_speaker_id);
    if (voicevoxExtractModeInput) {
      voicevoxExtractModeInput.value = (data?.voicevox_extract_mode ?? 'none').toString();
    }
    if (voicevoxSpeedScaleInput) {
      voicevoxSpeedScaleInput.value = normalizeNumberForInput(data?.voicevox_speed_scale);
    }
    if (voicevoxPitchScaleInput) {
      voicevoxPitchScaleInput.value = normalizeNumberForInput(data?.voicevox_pitch_scale, { allowNegative: true });
    }
    if (voicevoxIntonationScaleInput) {
      voicevoxIntonationScaleInput.value = normalizeNumberForInput(data?.voicevox_intonation_scale);
    }
    if (voicevoxVolumeScaleInput) {
      voicevoxVolumeScaleInput.value = normalizeNumberForInput(data?.voicevox_volume_scale);
    }
    if (voicevoxPrePhonemeLengthInput) {
      voicevoxPrePhonemeLengthInput.value = normalizeNumberForInput(data?.voicevox_pre_phoneme_length);
    }
    if (voicevoxPostPhonemeLengthInput) {
      voicevoxPostPhonemeLengthInput.value = normalizeNumberForInput(data?.voicevox_post_phoneme_length);
    }
    if (voicevoxPauseLengthInput) {
      voicevoxPauseLengthInput.value = normalizeNumberForInput(data?.voicevox_pause_length);
    }
    if (voicevoxPauseLengthScaleInput) {
      voicevoxPauseLengthScaleInput.value = normalizeNumberForInput(data?.voicevox_pause_length_scale);
    }
    if (voicevoxSyncTextPrintingInput) {
      voicevoxSyncTextPrintingInput.checked = Boolean(data?.voicevox_sync_text_printing);
    }

    updatePostPromptState();
    // DynamicContext機能のUIの状態を更新（有効/無効に応じてURL入力欄の活性/非活性を切り替え）
    updateDynamicContextState();

    // 変更検知用に元の値を保存
    originalSettings = {
      displayName: displayInput?.value ?? '',
      modelName: modelInput?.value ?? '',
      systemPrompt: systemInput?.value ?? '',
      timerCycle: timerInput?.value ?? '',
      webhookUrl: webhookUrlInput?.value ?? '',
      webhookBody: webhookBodyInput?.value ?? '',
      enablePostPrompt: enablePostPromptInput?.checked ?? false,
      postPrompt: postPromptInput?.value ?? '',
      postProcessScript: postProcessScriptInput?.value ?? '',
      // DynamicContext機能の有効/無効状態を保存（変更検知に使用）
      enableDynamicContext: enableDynamicContextInput?.checked ?? false,
      // DynamicContextのURL設定を保存（変更検知に使用）
      dynamicContextUrl: dynamicContextUrlInput?.value ?? '',
      dynamicContextHistoryTurns: dynamicContextHistoryTurnsInput?.value ?? '',
      talkHistoryCutoffHours: talkHistoryCutoffHoursInput?.value ?? '',
      removeAttachment: removeAttachmentInput?.checked ?? false,
      voicevoxSpeakerId: voicevoxSpeakerIdInput?.value ?? '',
      voicevoxExtractMode: voicevoxExtractModeInput?.value ?? 'none',
      voicevoxSpeedScale: voicevoxSpeedScaleInput?.value ?? '',
      voicevoxPitchScale: voicevoxPitchScaleInput?.value ?? '',
      voicevoxIntonationScale: voicevoxIntonationScaleInput?.value ?? '',
      voicevoxVolumeScale: voicevoxVolumeScaleInput?.value ?? '',
      voicevoxPrePhonemeLength: voicevoxPrePhonemeLengthInput?.value ?? '',
      voicevoxPostPhonemeLength: voicevoxPostPhonemeLengthInput?.value ?? '',
      voicevoxPauseLength: voicevoxPauseLengthInput?.value ?? '',
      voicevoxPauseLengthScale: voicevoxPauseLengthScaleInput?.value ?? '',
      voicevoxSyncTextPrinting: voicevoxSyncTextPrintingInput?.checked ?? false
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
 * DynamicContext（動的コンテキスト）機能のUI制御を初期化する
 *
 * この関数は以下の処理を行います：
 * 1. DynamicContext機能の有効/無効を切り替えるチェックボックスを取得
 * 2. チェックボックスの状態変更イベントリスナーを設定
 * 3. 初期表示時のUI状態を更新
 *
 * DynamicContext機能は、LLMとの会話時に外部APIから動的にコンテキスト情報を取得し、
 * システムプロンプトに追加する機能です。例えば、現在時刻や天気情報など、
 * 実行時に変化する情報をリアルタイムに会話に組み込むことができます。
 */
function setupDynamicContextControls() {
  // DynamicContext機能の有効/無効切り替え用のチェックボックス要素を取得
  const toggle = document.getElementById('enableDynamicContext');
  const turnsInput = document.getElementById('dynamicContextHistoryTurns');
  // 要素が見つからない場合は処理を中断
  if (!toggle) {
    return;
  }

  // チェックボックスの状態が変更されたときのイベントリスナーを登録
  // チェックのON/OFFに応じてURL入力欄の有効/無効を切り替える
  toggle.addEventListener('change', () => {
    updateDynamicContextState();
  });

  if (turnsInput) {
    turnsInput.addEventListener('input', () => setTurnsWithinBounds(turnsInput));
  }

  // 初期表示時のUI状態を設定（チェックボックスの現在の状態に基づいてURL入力欄を有効化/無効化）
  updateDynamicContextState();
}

/**
 * DynamicContext機能のUI状態を更新する
 *
 * この関数は、DynamicContext機能の有効/無効チェックボックスの状態に応じて、
 * URL入力欄の有効化/無効化を制御します。
 *
 * 動作仕様：
 * - チェックボックスがONの場合：URL入力欄を有効化（編集可能）
 * - チェックボックスがOFFの場合：URL入力欄を無効化（グレーアウト、編集不可）
 *
 * これにより、DynamicContext機能を使用しない場合に誤ってURLを入力することを防ぎ、
 * UIの使い勝手を向上させます。
 */
function updateDynamicContextState() {
  // DynamicContext機能の有効/無効切り替え用チェックボックスを取得
  const toggle = document.getElementById('enableDynamicContext');
  // DynamicContextで使用する外部APIのURLを入力するテキストボックスを取得
  const urlInput = document.getElementById('dynamicContextUrl');
  const turnsInput = document.getElementById('dynamicContextHistoryTurns');

  // いずれかの要素が見つからない場合は処理を中断
  if (!toggle || !urlInput || !turnsInput) {
    return;
  }

  // チェックボックスの状態に応じてURL入力欄の有効/無効を切り替え
  // toggle.checked が true（チェックON）の場合は disabled = false（有効化）
  // toggle.checked が false（チェックOFF）の場合は disabled = true（無効化）
  const enabled = toggle.checked;
  urlInput.disabled = !enabled;
  turnsInput.disabled = !enabled;
}

function setTurnsWithinBounds(input) {
  const min = 0;
  const raw = Number.parseInt(input.value ?? '', 10);
  if (!Number.isFinite(raw)) {
    input.value = String(min);
    return;
  }
  input.value = String(Math.max(min, raw));
}

/**
 * ペルソナ資産（アイコン・背景画像）を読み込む
 */
async function loadPersonaAssets() {
  await Promise.all(assetConfig.map(loadPersonaAsset));
}

function createVoicevoxUnsetOption() {
  const option = document.createElement('option');
  option.value = '';
  option.textContent = '未設定（オフ）';
  return option;
}

async function loadVoicevoxSpeakers() {
  const select = document.getElementById('voicevoxSpeakerId');
  if (!select) {
    return;
  }

  select.innerHTML = '';
  select.appendChild(createVoicevoxUnsetOption());
  const loadingOption = document.createElement('option');
  loadingOption.disabled = true;
  loadingOption.textContent = '話者一覧を読み込み中...';
  select.appendChild(loadingOption);
  select.value = desiredVoicevoxSpeakerId === null ? '' : String(desiredVoicevoxSpeakerId);

  try {
    const data = await fetchJson('/api/voicevox/speakers');
    const entries = Object.entries(data ?? {})
      .map(([label, id]) => ({ label, id: parseNumberInput(id, { allowNegative: true, integer: true }) }))
      .filter((entry) => Number.isFinite(entry.id));

    entries.sort((a, b) => a.label.localeCompare(b.label, 'ja'));

    select.innerHTML = '';
    select.appendChild(createVoicevoxUnsetOption());

    entries.forEach((entry) => {
      const option = document.createElement('option');
      option.value = String(entry.id);
      option.textContent = `${entry.label} (${entry.id})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Failed to load VoiceVox speakers:', error);
    select.innerHTML = '';
    select.appendChild(createVoicevoxUnsetOption());
    const errorOption = document.createElement('option');
    errorOption.disabled = true;
    errorOption.textContent = '話者一覧を取得できませんでした';
    select.appendChild(errorOption);
  } finally {
    applyVoicevoxSpeakerSelection();
  }
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
  payload.post_process_script = document.getElementById('postProcessScript')?.value ?? '';
  payload.enable_dynamic_context = document.getElementById('enableDynamicContext')?.checked ?? false;
  payload.dynamic_context_url = document.getElementById('dynamicContextUrl')?.value ?? '';
  const turnsInput = document.getElementById('dynamicContextHistoryTurns');
  const parsedTurns = Number.parseInt(turnsInput?.value ?? '', 10);
  payload.dynamic_context_history_turns = Number.isFinite(parsedTurns) && parsedTurns >= 0 ? parsedTurns : 8;
  const cutoffInput = document.getElementById('talkHistoryCutoffHours');
  const parsedCutoff = Number.parseInt(cutoffInput?.value ?? '', 10);
  payload.talk_history_cutoff_by_past_hours = Number.isFinite(parsedCutoff) && parsedCutoff >= 0 ? parsedCutoff : 0;
  payload.remove_attachment = document.getElementById('removeAttachment')?.checked ?? false;
  payload.voicevox_speaker_id = parseNumberInput(document.getElementById('voicevoxSpeakerId')?.value, { allowNegative: true, integer: true });
  payload.voicevox_extract_mode = document.getElementById('voicevoxExtractMode')?.value ?? 'none';
  payload.voicevox_speed_scale = parseNumberInput(document.getElementById('voicevoxSpeedScale')?.value);
  payload.voicevox_pitch_scale = parseNumberInput(document.getElementById('voicevoxPitchScale')?.value, { allowNegative: true });
  payload.voicevox_intonation_scale = parseNumberInput(document.getElementById('voicevoxIntonationScale')?.value);
  payload.voicevox_volume_scale = parseNumberInput(document.getElementById('voicevoxVolumeScale')?.value);
  payload.voicevox_pre_phoneme_length = parseNumberInput(document.getElementById('voicevoxPrePhonemeLength')?.value);
  payload.voicevox_post_phoneme_length = parseNumberInput(document.getElementById('voicevoxPostPhonemeLength')?.value);
  payload.voicevox_pause_length = parseNumberInput(document.getElementById('voicevoxPauseLength')?.value);
  payload.voicevox_pause_length_scale = parseNumberInput(document.getElementById('voicevoxPauseLengthScale')?.value);
  payload.voicevox_sync_text_printing = document.getElementById('voicevoxSyncTextPrinting')?.checked ?? false;

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
      postPrompt: payload.post_prompt,
      postProcessScript: payload.post_process_script,
      enableDynamicContext: payload.enable_dynamic_context,
      dynamicContextUrl: payload.dynamic_context_url,
      dynamicContextHistoryTurns: String(payload.dynamic_context_history_turns),
      talkHistoryCutoffHours: String(payload.talk_history_cutoff_by_past_hours),
      removeAttachment: payload.remove_attachment,
      voicevoxSpeakerId: normalizeNumberForInput(payload.voicevox_speaker_id, { allowNegative: true, integer: true }),
      voicevoxExtractMode: payload.voicevox_extract_mode ?? 'none',
      voicevoxSpeedScale: normalizeNumberForInput(payload.voicevox_speed_scale),
      voicevoxPitchScale: normalizeNumberForInput(payload.voicevox_pitch_scale, { allowNegative: true }),
      voicevoxIntonationScale: normalizeNumberForInput(payload.voicevox_intonation_scale),
      voicevoxVolumeScale: normalizeNumberForInput(payload.voicevox_volume_scale),
      voicevoxPrePhonemeLength: normalizeNumberForInput(payload.voicevox_pre_phoneme_length),
      voicevoxPostPhonemeLength: normalizeNumberForInput(payload.voicevox_post_phoneme_length),
      voicevoxPauseLength: normalizeNumberForInput(payload.voicevox_pause_length),
      voicevoxPauseLengthScale: normalizeNumberForInput(payload.voicevox_pause_length_scale),
      voicevoxSyncTextPrinting: payload.voicevox_sync_text_printing
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
  const postProcessScriptInput = document.getElementById('postProcessScript');
  const enableDynamicContextInput = document.getElementById('enableDynamicContext');
  const dynamicContextUrlInput = document.getElementById('dynamicContextUrl');
  const dynamicContextHistoryTurnsInput = document.getElementById('dynamicContextHistoryTurns');
  const talkHistoryCutoffHoursInput = document.getElementById('talkHistoryCutoffHours');
  const removeAttachmentInput = document.getElementById('removeAttachment');
  const voicevoxSpeakerIdInput = document.getElementById('voicevoxSpeakerId');
  const voicevoxExtractModeInput = document.getElementById('voicevoxExtractMode');
  const voicevoxSpeedScaleInput = document.getElementById('voicevoxSpeedScale');
  const voicevoxPitchScaleInput = document.getElementById('voicevoxPitchScale');
  const voicevoxIntonationScaleInput = document.getElementById('voicevoxIntonationScale');
  const voicevoxVolumeScaleInput = document.getElementById('voicevoxVolumeScale');
  const voicevoxPrePhonemeLengthInput = document.getElementById('voicevoxPrePhonemeLength');
  const voicevoxPostPhonemeLengthInput = document.getElementById('voicevoxPostPhonemeLength');
  const voicevoxPauseLengthInput = document.getElementById('voicevoxPauseLength');
  const voicevoxPauseLengthScaleInput = document.getElementById('voicevoxPauseLengthScale');
  const voicevoxSyncTextPrintingInput = document.getElementById('voicevoxSyncTextPrinting');

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
    (postProcessScriptInput?.value ?? '') !== originalSettings.postProcessScript ||
    (enableDynamicContextInput?.checked ?? false) !== originalSettings.enableDynamicContext ||
    (dynamicContextUrlInput?.value ?? '') !== originalSettings.dynamicContextUrl ||
    (dynamicContextHistoryTurnsInput?.value ?? '') !== originalSettings.dynamicContextHistoryTurns ||
    (talkHistoryCutoffHoursInput?.value ?? '') !== originalSettings.talkHistoryCutoffHours ||
    (removeAttachmentInput?.checked ?? false) !== originalSettings.removeAttachment ||
    (voicevoxSpeakerIdInput?.value ?? '') !== originalSettings.voicevoxSpeakerId ||
    (voicevoxExtractModeInput?.value ?? '') !== originalSettings.voicevoxExtractMode ||
    (voicevoxSpeedScaleInput?.value ?? '') !== originalSettings.voicevoxSpeedScale ||
    (voicevoxPitchScaleInput?.value ?? '') !== originalSettings.voicevoxPitchScale ||
    (voicevoxIntonationScaleInput?.value ?? '') !== originalSettings.voicevoxIntonationScale ||
    (voicevoxVolumeScaleInput?.value ?? '') !== originalSettings.voicevoxVolumeScale ||
    (voicevoxPrePhonemeLengthInput?.value ?? '') !== originalSettings.voicevoxPrePhonemeLength ||
    (voicevoxPostPhonemeLengthInput?.value ?? '') !== originalSettings.voicevoxPostPhonemeLength ||
    (voicevoxPauseLengthInput?.value ?? '') !== originalSettings.voicevoxPauseLength ||
    (voicevoxPauseLengthScaleInput?.value ?? '') !== originalSettings.voicevoxPauseLengthScale ||
    (voicevoxSyncTextPrintingInput?.checked ?? false) !== originalSettings.voicevoxSyncTextPrinting ||
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
