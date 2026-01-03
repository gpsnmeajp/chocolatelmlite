/**
 * ゲームトーク画面のJavaScript
 *
 * このファイルは、AIとのチャット機能を提供します。
 * メッセージの送受信、添付ファイルのアップロード、メッセージの編集・コピー、
 * リアルタイムポーリングによる自動更新などの機能が含まれます。
 */

// 添付ファイルの最大数
const MAX_ATTACHMENTS = 5;
const POLLING_INTERVAL_MS = 10000;
const WS_RECONNECT_BASE_DELAY_MS = 2000;
const WS_RECONNECT_MAX_DELAY_MS = 10000;
const WS_PING_TIMEOUT_MS = 5000;
const WS_PING_CHECK_INTERVAL_MS = 1000;

// アプリケーションの状態を管理するオブジェクト
const state = {
  attachments: [],    // 添付予定のファイル配列（送信前のプレビュー用）
  isSending: false,   // メッセージ送信中フラグ（二重送信防止用）
  editingUuid: null,  // 編集中のメッセージUUID（編集モード時に設定）
  messages: [],       // 現在表示中のメッセージ配列
  messagesHash: null, // 最後に取得したメッセージ配列のハッシュ
  personaName: '',    // アクティブなペルソナの名前（ヘッダー表示用）
  userName: 'あなた', // 一般設定で指定されたユーザー名（デフォルト値）
  personaMedia: {     // ペルソナ固有の画像アセット
    userAvatar: null,       // ユーザーアイコンのオブジェクトURL
    assistantAvatar: null,  // アシスタントアイコンのオブジェクトURL
    background: null,       // 背景画像のオブジェクトURL
    objectUrls: []          // メモリリーク防止のため、すべてのオブジェクトURLを追跡
  },
  pendingImages: 0,   // 読み込み待ちの画像枚数（スクロールタイミング制御用）
  deferScroll: false, // 画像読み込み完了後にスクロールを実行するかのフラグ
  messagesStartIndex: 0,    // 仮想スクロール: 現在表示中のメッセージの開始インデックス
  totalMessages: 0,         // サーバー上の全メッセージ数
  lastStats: null,          // 最後に取得した統計情報（情報バー表示用）
  editingAttachmentIds: [], // 編集中のメッセージに既に添付されているファイルIDリスト
  websocket: null,          // WebSocketインスタンス
  websocketStatus: 'disconnected', // WebSocket接続状態
  websocketReconnectAttempts: 0,    // 再接続試行回数
  websocketReconnectTimer: null,   // 再接続タイマー
  websocketShouldReconnect: true,  // クライアント都合で切断するかどうか
  pingMonitorHandle: null,         // ping監視タイマー
  lastPingReceivedAt: 0,           // 最終ping受信時刻
  liveGeneration: null,            // ストリーミング中のAI応答
  isCanceling: false,              // キャンセルリクエスト中フラグ
};

// 自動スクロールを継続するための閾値（px）
// スクロール位置が下端からこの距離以内にある場合、新しいメッセージ受信時に自動で最下部にスクロールする
const AUTO_SCROLL_THRESHOLD = 140;

// 仮想リストの表示件数設定
const INITIAL_VISIBLE_COUNT = 100;  // 初回読み込み時、または最新メッセージ表示時の件数
const VISIBLE_INCREMENT = 50;       // 上下スクロール時に追加読み込みする件数

// ロールごとのメタデータ（表示名、CSSクラス、アイコン）
const ROLE_META = {
  system: {
    label: 'システム',
    className: 'system',
    icon: '<svg viewBox="0 0 24 24"><path d="M12 1l3 5 5 3-5 3-3 5-3-5-5-3 5-3z"></path></svg>'
  },
  user: {
    label: 'あなた',
    className: 'user',
    icon: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'
  },
  assistant: {
    label: 'アシスタント',
    className: 'assistant',
    icon: '<svg viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>'
  },
  tool: {
    label: 'ツール',
    className: 'tool',
    icon: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>'
  },

  chocolatelm: {
    label: 'Chocolate LM',
    className: 'chocolatelm',
    icon: '🍫'
//    icon: '<svg viewBox="0 0 24 24"><path d="M5 3h9l5 5v13H5z"></path><path d="M14 3v5h5"></path><path d="M9 9v4"></path><path d="M13 9v4"></path><path d="M9 15v4"></path><path d="M13 15v4"></path></svg>'
  },

  unknown: {
    label: '不明',
    className: 'unknown',
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path d="M12 16h.01"></path><path d="M12 8a2.5 2.5 0 0 1 0 5"></path></svg>'
  }
};

// ペルソナ固有画像のファイル名
// サーバーの /api/persona/active/ エンドポイントから取得するファイル名
const PERSONA_MEDIA_FILES = {
  user: 'user.png',           // ユーザーアイコン画像
  assistant: 'assistant.png', // アシスタントアイコン画像
  background: 'background.png' // チャット背景画像
};

let endpointRedirectPending = false;

// LLMエンドポイント未設定時の初期設定促進モーダル
async function promptEndpointSetup() {
  if (endpointRedirectPending) {
    return;
  }

  endpointRedirectPending = true;

  const modal = typeof ensureConfirmModal === 'function' ? ensureConfirmModal() : null;
  let cancelBtn = null;

  // キャンセルボタンを非表示にする
  if (modal instanceof HTMLElement) {
    cancelBtn = modal.querySelector('[data-app-modal-cancel]');
    if (cancelBtn instanceof HTMLElement) {
      cancelBtn.dataset.originalDisplay = cancelBtn.style.display;
      cancelBtn.style.display = 'none';
      cancelBtn.setAttribute('aria-hidden', 'true');
    }
  }

  const messageLines = [
    'LLMエンドポイントが未設定です。',
    'システム設定でエンドポイントとAPIキーを設定してください。'
  ];

  try {
    // showAlertModalは待機できないため、showConfirmModalを使用
    if (typeof showConfirmModal === 'function') {
      await showConfirmModal(messageLines.join('<br>'), {
        title: '初期設定が必要です',
        confirmLabel: 'システム設定を開く',
        cancelLabel: ''
      });
    }
  } catch (error) {
    console.warn('Failed to show endpoint missing modal:', error);
  } finally {
    // キャンセルボタンを元に戻す
    if (cancelBtn instanceof HTMLElement) {
      cancelBtn.style.display = cancelBtn.dataset.originalDisplay || '';
      cancelBtn.removeAttribute('aria-hidden');
      delete cancelBtn.dataset.originalDisplay;
    }

    window.location.href = 'system.htm';
  }
}


// marked.js の設定
marked.setOptions({
  gfm: true,    // GitHub Flavored Markdownを有効化（テーブル、タスクリストなど）
  breaks: true, // 単一の改行を<br>に変換（GFMスタイル）
  highlight(code, lang) {
    // コードブロックのシンタックスハイライト処理（常にhighlight.jsを使用）
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch (error) {
      console.warn('Failed to highlight code block:', error);
      return code;
    }
  }
});

/**
 * 数値をロールキーに変換
 *
 * サーバーから数値で返されるロール情報を文字列キーに変換します。
 * 0: system, 1: user, 2: assistant, 3: tool
 *
 * @param {number} roleNumber - ロール番号
 * @returns {string} - ロールキー文字列
 */
function numberToRoleKey(roleNumber) {
  // 数値をロール文字列に変換（サーバーのenum定義に対応）
  switch (Number(roleNumber)) {
    case 0:
      return 'system';    // システムメッセージ
    case 1:
      return 'user';      // ユーザーメッセージ
    case 2:
      return 'assistant'; // アシスタント（AI）メッセージ
    case 3:
      return 'tool';      // ツール実行結果メッセージ
    case 4:
      return 'chocolatelm'; // Chocolate LM Liteシステムメッセージ
    default:
      return 'unknown';   // 未知のロール
  }
}

/**
 * ロール値を正規化
 *
 * 文字列または数値のロール値を統一された文字列キーに変換します。
 *
 * @param {string|number} roleValue - ロール値
 * @returns {string} - 正規化されたロールキー
 */
function normalizeRole(roleValue) {
  // 文字列の場合の処理
  if (typeof roleValue === 'string') {
    // 前後の空白を削除
    const trimmed = roleValue.trim();
    if (!trimmed) {
      return 'unknown';
    }

    // 小文字に統一
    const lowered = trimmed.toLowerCase();

    // 定義済みのロールキーに一致する場合はそのまま返す
    if (ROLE_META[lowered]) {
      return lowered;
    }

    // 数値文字列（"0", "1", "2", "3"など）の場合は数値に変換
    return numberToRoleKey(Number(trimmed));
  }

  // 数値の場合は直接変換
  if (typeof roleValue === 'number') {
    return numberToRoleKey(roleValue);
  }

  // その他の型の場合は不明として扱う
  return 'unknown';
}

/**
 * テキストエリアの高さを自動調整
 *
 * テキストエリアの内容に応じて高さを動的に変更します。
 * 最小40px、最大は画面高さの50%まで。
 *
 * @param {HTMLTextAreaElement} textarea - 調整対象のテキストエリア
 */
function autoResizeTextarea(textarea) {
  // 最小高さ（1行分）と最大高さ（画面の50%）を定義
  const minHeight = 40;
  const maxHeight = window.innerHeight * 0.5;

  // 一度最小サイズにリセット（scrollHeightを正確に取得するため）
  textarea.style.height = `${minHeight}px`;

  // コンテンツの実際の高さを取得
  const scrollHeight = textarea.scrollHeight;

  if (scrollHeight > minHeight) {
    // コンテンツに合わせて高さを調整（最大値まで）
    const newHeight = Math.min(scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;

    // 最大高さに達したらスクロールバーを表示、それ以外は非表示
    textarea.style.overflowY = newHeight >= maxHeight ? 'auto' : 'hidden';
  } else {
    // コンテンツが最小高さ以下の場合
    textarea.style.height = `${minHeight}px`;
    textarea.style.overflowY = 'hidden';
  }
}

/**
 * 設定画面に遷移
 */
function goToSettings() {
  window.location.href = 'setting.htm';
}

/**
 * ペルソナ管理画面に遷移
 */
function goToPersonas() {
  window.location.href = 'personas.htm';
}

/**
 * キーボードイベントハンドラー
 *
 * Enterキー単体で送信、Shift+Enterで改行
 *
 * @param {KeyboardEvent} event - キーボードイベント
 */
function handleKeydown(event) {
  // Enterキー単体の場合はメッセージ送信
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
  // Shift+Enterの場合は改行（デフォルト動作）
}

/**
 * 初期化関数
 *
 * ページ読み込み時にペルソナ情報とメッセージ履歴を読み込み、
 * 自動更新のためのポーリングを開始します。
 */
async function init() {
  setupScrollObservers();
  const generalSettingsLoaded = await loadGeneralSettings();
  if (!generalSettingsLoaded) {
    showAlertModal('通信に失敗しました。ページを再読み込みしてください。', { title: '全体設定読み込みエラー' });
    return;
  }
  await loadPersonaSummary();
  await loadPersonaMedia();
  await reloadMessages({ forceScroll: true });
  startRealtime();
  refreshSendButton();
}

/**
 * UNIXタイムスタンプを日本語形式の日時文字列に変換
 *
 * @param {number} unixSeconds - UNIXタイムスタンプ（秒）
 * @returns {string} - フォーマットされた日時文字列
 */
function formatTimestamp(unixSeconds) {
  // タイムスタンプが存在しない場合は空文字を返す
  if (!unixSeconds) {
    return '';
  }

  // UNIXタイムスタンプ（秒）をミリ秒に変換してDateオブジェクトを作成
  const date = new Date(unixSeconds * 1000);

  // 日本語形式でフォーマット
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/**
 * アクティブなペルソナのサマリー情報を読み込む
 *
 * ペルソナ名を取得してヘッダーに表示します。
 */
async function loadPersonaSummary() {
  try {
    // サーバーからペルソナ設定を取得
    const data = await fetchJson('/api/persona/active/setting');

    if (data && data.name) {
      // 状態にペルソナ名を保存
      state.personaName = data.name;

      // ヘッダータイトルを更新
      const title = document.querySelector('.chat-title');
      if (title) {
        title.textContent = data.name;
      }
    }
  } catch (error) {
    console.error('Failed to load persona summary:', error);
  }
}

/**
 * 一般設定を読み込みユーザー名を更新
 *
 * サーバーの一般設定APIからYourNameを取得し、表示名として保持します。
 */
async function loadGeneralSettings() {
  try {
    const data = await fetchJson('/api/setting');
    const settings = data?.settings ?? {};
    const endpoint = typeof settings?.LlmEndpointUrl === 'string' ? settings.LlmEndpointUrl.trim() : '';

    if (!endpoint) {
      await promptEndpointSetup();
      return true; // 余計なエラーメッセージを出さない
    }

    const rawName = typeof settings.YourName === 'string' ? settings.YourName : '';
    const trimmed = rawName.trim();
    // ユーザー名が設定されている場合は状態を更新
    if (trimmed) {
      state.userName = trimmed;

      // 既にメッセージが読み込まれている場合は再描画して表示名を更新
      if (state.messages.length > 0) {
        renderMessages();
      }
      updateInfoBar();
    }

    return true;
  } catch (error) {
    console.error('Failed to load general settings:', error);
    return true;
  }
}

/**
 * チャット画面の背景画像を適用
 *
 * @param {string|null} url - 背景画像URL
 */
function applyBackgroundImage(url) {
  // チャットメッセージコンテナを取得
  const chatMessages = document.querySelector('.chat-messages');
  if (!chatMessages) {
    return;
  }

  // CSS変数からオーバーレイ色を取得（デフォルト: 半透明の黒）
  const overlayColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--chat-background-overlay-color')
    .trim() || 'rgba(0, 0, 0, 0.38)';

  // オーバーレイグラデーションを作成（テキストの可読性向上のため）
  const overlayGradient = `linear-gradient(${overlayColor}, ${overlayColor})`;

  if (url) {
    // 背景画像を設定（オーバーレイと画像の2層構造）
    chatMessages.style.backgroundImage = `${overlayGradient}, url('${url}')`;
    chatMessages.style.backgroundSize = 'cover, cover';
    chatMessages.style.backgroundPosition = 'center, center';
    chatMessages.style.backgroundRepeat = 'no-repeat, no-repeat';
    chatMessages.style.backgroundAttachment = 'fixed, fixed';
    chatMessages.classList.add('has-background-image');
  } else {
    // 背景画像がない場合は、すべてのスタイルをクリア
    chatMessages.style.removeProperty('background-image');
    chatMessages.style.removeProperty('background-size');
    chatMessages.style.removeProperty('background-position');
    chatMessages.style.removeProperty('background-repeat');
    chatMessages.style.removeProperty('background-attachment');
    chatMessages.classList.remove('has-background-image');
  }
}

/**
 * ペルソナ固有のメディアを解放
 *
 * メモリリークを防ぐため、オブジェクトURLを解放し、状態をクリアします。
 * ページ離脱時やペルソナ切り替え時に呼び出されます。
 */
function cleanupPersonaMedia() {
  // すべてのオブジェクトURLを解放してメモリリークを防止
  state.personaMedia.objectUrls.forEach(url => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  });

  // 状態をクリア
  state.personaMedia.objectUrls = [];
  state.personaMedia.userAvatar = null;
  state.personaMedia.assistantAvatar = null;
  state.personaMedia.background = null;

  // 背景画像を削除
  applyBackgroundImage(null);
}

/**
 * ペルソナ固有のメディアファイルを取得
 *
 * @param {string} fileName - 取得するファイル名
 * @returns {Promise<string|null>} - 取得したオブジェクトURL
 */
async function fetchPersonaMediaFile(fileName) {
  try {
    const response = await fetch(`/api/persona/active/${fileName}`, { cache: 'no-store' });
    // レスポンスが正常でない場合
    if (!response.ok) {
      // 404以外のエラーの場合は警告を出力（404は画像未設定として扱う）
      if (response.status !== 404) {
        console.warn(`Failed to load persona media (${fileName}): status ${response.status}`);
      }
      return null;
    }

    // Blobデータを取得
    const blob = await response.blob();
    // Blobが空の場合はnullを返す
    if (!blob || blob.size === 0) {
      return null;
    }

  return URL.createObjectURL(blob);
  } catch (error) {
    console.warn(`Failed to load persona media (${fileName}):`, error);
    return null;
  }
}

/**
 * ペルソナ固有のアイコンと背景を読み込む
 *
 * ユーザーアバター、アシスタントアバター、背景画像の3つを並列で取得します。
 * 古いオブジェクトURLは解放してメモリリークを防止します。
 * アバターが変更された場合は、既存のメッセージを再描画して新しいアバターを反映します。
 */
async function loadPersonaMedia() {
  // 以前のURLを保存（後で解放するため）
  const previousUrls = state.personaMedia.objectUrls.slice();
  const previousUser = state.personaMedia.userAvatar;
  const previousAssistant = state.personaMedia.assistantAvatar;

  // 3つのメディアファイルを並列で取得（パフォーマンス向上のため）
  const [userUrl, assistantUrl, backgroundUrl] = await Promise.all([
    fetchPersonaMediaFile(PERSONA_MEDIA_FILES.user),
    fetchPersonaMediaFile(PERSONA_MEDIA_FILES.assistant),
    fetchPersonaMediaFile(PERSONA_MEDIA_FILES.background)
  ]);

  // 古いオブジェクトURLを解放してメモリリークを防止
  previousUrls.forEach(url => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  });

  // URLリストをリセット
  state.personaMedia.objectUrls = [];

  // ユーザーアバターを設定
  state.personaMedia.userAvatar = userUrl ?? null;
  if (userUrl) {
    state.personaMedia.objectUrls.push(userUrl);
  }

  // アシスタントアバターを設定
  state.personaMedia.assistantAvatar = assistantUrl ?? null;
  if (assistantUrl) {
    state.personaMedia.objectUrls.push(assistantUrl);
  }

  // 背景画像を設定
  state.personaMedia.background = backgroundUrl ?? null;
  if (backgroundUrl) {
    state.personaMedia.objectUrls.push(backgroundUrl);
    applyBackgroundImage(backgroundUrl);  // 背景画像を適用
  } else {
    applyBackgroundImage(null);  // 背景画像をクリア
  }

  // アバターが変更された場合は、既存のメッセージを再描画して新しいアバターを表示
  const avatarChanged =
    previousUser !== state.personaMedia.userAvatar ||
    previousAssistant !== state.personaMedia.assistantAvatar;

  if (avatarChanged && state.messages.length > 0) {
    renderMessages();
  }
}

/**
 * ロール値に対応するメタデータを取得
 *
 * アシスタントロールの場合は、現在のペルソナ名を表示名として使用します。
 * ユーザーロールの場合は、一般設定で設定されたユーザー名を表示名として使用します。
 *
 * @param {string|number} roleValue - ロール値
 * @returns {Object} - ロールメタデータ（label, className, icon）
 */
function getRoleMeta(roleValue) {
  const key = normalizeRole(roleValue);
  const baseMeta = ROLE_META[key] || ROLE_META.unknown;

  // アシスタントロールの場合は、ペルソナ名を表示名として使用
  if (key === 'assistant') {
    return { ...baseMeta, label: state.personaName || baseMeta.label };
  }

  // ユーザーロールの場合は、設定されたユーザー名を表示名として使用
  if (key === 'user') {
    return { ...baseMeta, label: state.userName || baseMeta.label };
  }

  return baseMeta;
}

/**
 * 入力フィールドをリセット
 *
 * テキストエリアの内容をクリアし、高さを初期状態に戻します。
 */
function resetInput() {
  const input = document.getElementById('chatInput');
  if (!input) {
    return;
  }

  // テキストをクリア
  input.value = '';

  // 高さを初期状態に戻す
  input.style.height = '40px';
  input.style.overflowY = 'hidden';
}

/**
 * 添付ファイルをクリア
 *
 * すべての添付ファイルを削除し、メモリリークを防ぐためにオブジェクトURLを解放します。
 */
function clearAttachments() {
  // オブジェクトURLを解放してメモリリークを防ぐ
  state.attachments.forEach(item => URL.revokeObjectURL(item.previewUrl));

  // 配列をクリア
  state.attachments = [];

  // プレビュー表示を更新
  updateAttachmentPreview();
}

/**
 * ファイル選択時の処理
 *
 * 選択されたファイルを添付リストに追加します。
 * 最大5件までに制限されます。
 *
 * @param {HTMLInputElement} input - ファイル入力要素
 */
function handleAttachment(input) {
  // 選択されたファイルを配列に変換
  const files = Array.from(input.files || []);

  // ファイル入力をリセット（同じファイルを再選択できるようにする）
  input.value = '';

  // ファイルが選択されていない場合は終了
  if (files.length === 0) {
    return;
  }

  // 現在の添付数から追加可能な残り枠を計算
  const remainingSlots = MAX_ATTACHMENTS - state.attachments.length;

  // 既に上限に達している場合は警告して終了
  if (remainingSlots <= 0) {
    showAlertModal(`添付ファイルは最大${MAX_ATTACHMENTS}件までです。`, { title: '添付ファイル' });
    return;
  }

  // 残り枠の範囲内で追加できる分だけファイルを取得
  const filesToAdd = files.slice(0, remainingSlots);

  // 各ファイルのプレビューURLを作成して添付リストに追加
  filesToAdd.forEach(file => {
    // BlobからプレビューURLを生成
    const previewUrl = URL.createObjectURL(file);
    state.attachments.push({ file, previewUrl });
  });

  // UIのプレビュー表示を更新
  updateAttachmentPreview();

  // 選択したファイルが上限を超えていた場合は警告を表示
  if (files.length > remainingSlots) {
    showAlertModal(`添付ファイルは最大${MAX_ATTACHMENTS}件までです。先頭から${remainingSlots}件のみ追加しました。`, { title: '添付ファイル' });
  }
}

/**
 * 添付ファイルのプレビューを更新
 *
 * 添付リスト内のファイルを画像プレビューとして表示します。
 */
function updateAttachmentPreview() {
  const preview = document.getElementById('attachmentPreview');
  if (!preview) {
    return;
  }

  // 添付リストからHTMLを生成
  preview.innerHTML = state.attachments
    .map((att, index) => `
      <div class="attachment-item" data-index="${index}">
        <img src="${att.previewUrl}" alt="添付画像 ${index + 1}">
        <button class="attachment-remove" onclick="removeAttachment(${index})">×</button>
      </div>
    `)
    .join('');
}

/**
 * 添付ファイルを削除
 *
 * 指定したインデックスの添付ファイルを削除します。
 *
 * @param {number} index - 削除する添付ファイルのインデックス
 */
function removeAttachment(index) {
  const item = state.attachments[index];

  // オブジェクトURLを解放してメモリリークを防ぐ
  if (item) {
    URL.revokeObjectURL(item.previewUrl);
  }

  // 配列から削除
  state.attachments.splice(index, 1);

  // プレビュー表示を更新
  updateAttachmentPreview();
}

/**
 * 添付ファイルをサーバーにアップロード
 *
 * FormDataを使用してファイルをアップロードし、サーバーから返された添付IDを取得します。
 *
 * @param {File} file - アップロードするファイル
 * @returns {Promise<number>} - サーバーから返された添付ファイルID
 */
async function uploadAttachment(file) {
  // FormDataを作成してファイルを追加
  const formData = new FormData();
  formData.append('file', file);

  // サーバーにアップロード
  const response = await fetch('/api/persona/active/attachment', {
    method: 'POST',
    body: formData
  });

  // レスポンスの確認
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || '添付ファイルのアップロードに失敗しました');
  }

  // JSONレスポンスをパース
  const json = await response.json();

  // IDの存在確認
  if (!json || typeof json.id === 'undefined') {
    throw new Error('添付ファイルIDの取得に失敗しました');
  }

  return json.id;
}

/**
 * メッセージ送信処理の共通ロジック
 *
 * 入力テキストと添付ファイルをまとめてサーバーへ送信します。
 * 編集時にも利用できるように、UUIDの有無でモードを切り替えます。
 *
 * @param {Object} options - 送信オプション
 * @param {string} options.text - 送信するテキスト
 * @param {string|null} [options.editingUuid=null] - 編集対象のメッセージUUID
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function performMessageSend({ text, editingUuid = null }) {
  const trimmedText = typeof text === 'string' ? text.trim() : '';
  const normalizedUuid = typeof editingUuid === 'string' && editingUuid ? editingUuid : null;

  const existingAttachmentIds = normalizedUuid ? state.editingAttachmentIds.slice() : [];
  const hasText = trimmedText.length > 0;
  const hasNewAttachments = state.attachments.length > 0;
  const hasExistingAttachments = existingAttachmentIds.length > 0;

  if (!hasText && !hasNewAttachments && !hasExistingAttachments) {
    return { sent: false, reason: 'empty' };
  }

  if (state.isSending) {
    return { sent: false, reason: 'busy' };
  }

  state.isSending = true;
  refreshSendButton();

  try {
    const attachmentIds = existingAttachmentIds;

    if (hasNewAttachments) {
      try {
        for (const attachment of state.attachments) {
          const id = await uploadAttachment(attachment.file);
          attachmentIds.push(id);
        }
      } catch (error) {
        const wrappedError = error instanceof Error ? error : new Error(String(error));
        wrappedError.__attachmentUploadFailed = true;
        throw wrappedError;
      }
    }

    const messagePayload = {
      Role: 'user',
      Text: trimmedText,
      Timestamp: Math.floor(Date.now() / 1000)
    };

    if (attachmentIds.length > 0) {
      messagePayload.AttachmentId = attachmentIds;
    }

    if (normalizedUuid) {
      messagePayload.Uuid = normalizedUuid;
    }

    const data = await fetchJson('/api/persona/active/message', {
      method: 'POST',
      body: JSON.stringify(messagePayload)
    });

    if (data && data.error) {
      throw new Error(data.error);
    }

    return { sent: true };
  } finally {
    state.isSending = false;
    refreshSendButton();
  }
}

/**
 * AI応答の生成が進行中かどうかを判定
 * @returns {boolean} - 生成中の場合はtrue
 */
function isGenerationActive() {
  const status = state.liveGeneration?.status;
  if (!status) {
    return false;
  }
  const lowered = String(status).toLowerCase();
  return lowered === 'started' || lowered === 'generating';
}

/**
 * 送信ボタンの表示を更新
 * 生成中、キャンセル中、通常送信の3状態を表示
 */
function refreshSendButton() {
  const button = document.getElementById('sendBtn');
  if (!button) {
    return;
  }

  if (state.isCanceling) {
    button.textContent = 'キャンセル中...';
    button.classList.add('generating');
    button.disabled = true;
    return;
  }

  if (isGenerationActive()) {
    button.textContent = 'キャンセル';
    button.classList.add('generating');
    button.disabled = false;
    return;
  }

  button.classList.remove('generating');
  button.textContent = '送信';
  button.disabled = state.isSending;
}

/**
 * AI応答の生成をキャンセル
 * サーバーにキャンセルリクエストを送信し、状態を更新
 */
async function cancelGeneration() {
  if (state.isCanceling) {
    return;
  }

  state.isCanceling = true;
  refreshSendButton();

  try {
    await fetchJson('/api/persona/active/cancel', {
      method: 'POST',
      body: JSON.stringify({})
    });

    if (state.liveGeneration) {
      handleStatusBroadcast({
        status: 'canceled',
        response: state.liveGeneration.text || ''
      });
    }
  } catch (error) {
    console.error('Failed to cancel generation:', error);
    showAlertModal('生成のキャンセルに失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
  } finally {
    state.isCanceling = false;
    refreshSendButton();
  }
}

/**
 * メッセージを送信
 *
 * テキストと添付ファイルをサーバーに送信します。
 * 編集モードの操作はモーダルから行うため、この関数は新規送信用です。
 */
async function sendMessage() {
  if (state.editingUuid) {
    showAlertModal('編集中のメッセージがあります。先に編集を完了してください。', { title: '編集' });
    return;
  }

  if (isGenerationActive()) {
    await cancelGeneration();
    return;
  }

  if (state.isCanceling) {
    return;
  }

  const input = document.getElementById('chatInput');
  if (!input) {
    return;
  }

  const text = input.value;

  let result;
  try {
    result = await performMessageSend({ text });
  } catch (error) {
    console.error('Failed to send message:', error);
    if (error && typeof error === 'object' && error.__attachmentUploadFailed) {
      showAlertModal('添付ファイルのアップロードに失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
    } else {
      showAlertModal('メッセージの送信に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
    }
    return;
  }

  if (!result.sent) {
    return;
  }

  resetInput();
  clearAttachments();
  await reloadMessages({ forceScroll: true });
}

/**
 * メッセージをクリップボードにコピー
 *
 * @param {HTMLElement} btn - コピーボタン要素
 */
async function copyMessage(btn) {
  // メッセージ要素を取得
  const messageElem = btn.closest('.message');
  if (!messageElem) {
    return;
  }

  // メッセージのUUIDを取得
  const uuid = messageElem.dataset.uuid;

  // 対象メッセージを検索
  const target = state.messages.find(item => item.Uuid === uuid);
  if (!target) {
    return;
  }

  const textToCopy = target.Text || '';
  const originalHTML = btn.innerHTML;

  try {
    // Clipboard APIが利用できない環境の場合は例外をスロー
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('Clipboard API is unavailable.');
    }

    await navigator.clipboard.writeText(textToCopy);

    // ボタンのアイコンを一時的にチェックマークに変更
    btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    btn.style.color = 'var(--success-color)';

    // 2秒後に元に戻す
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.style.color = '';
    }, 2000);
  } catch (error) {
    console.error('Failed to copy message:', error);
    showCopyFallbackModal(textToCopy);
  }
}

// コピーモーダルを閉じた後にフォーカスを戻す要素を保存
let copyModalLastActiveElement = null;

/**
 * コピー用フォールバックモーダルを表示
 *
 * Clipboard APIが利用できない環境で、テキストを手動でコピーできるモーダルを表示します。
 *
 * @param {string} text - コピーするテキスト
 */
function showCopyFallbackModal(text) {
  const modal = ensureCopyFallbackModal();
  const textarea = modal.querySelector('.copy-modal-text');

  // テキストエリアに内容を設定
  textarea.value = text;
  textarea.scrollTop = 0;

  // モーダルを表示
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');

  // 現在のフォーカス要素を保存（モーダルを閉じる時に復元するため）
  copyModalLastActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  // テキストエリアにフォーカスして全選択
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.select();
  });
}

/**
 * コピー用フォールバックモーダルを非表示
 */
function hideCopyFallbackModal() {
  const modal = document.getElementById('copyFallbackModal');
  if (!modal) {
    return;
  }

  // モーダルを非表示
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');

  // 以前フォーカスしていた要素に戻す
  if (copyModalLastActiveElement) {
    copyModalLastActiveElement.focus();
    copyModalLastActiveElement = null;
  }
}

/**
 * コピー用フォールバックモーダルを作成または取得
 *
 * モーダルが存在しない場合は動的に生成し、DOMに追加します。
 *
 * @returns {HTMLElement} - モーダル要素
 */
function ensureCopyFallbackModal() {
  let modal = document.getElementById('copyFallbackModal');
  if (modal) {
    return modal;
  }

  // モーダル要素を動的に作成
  modal = document.createElement('div');
  modal.id = 'copyFallbackModal';
  modal.className = 'copy-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'copyFallbackModalTitle');

  modal.innerHTML = `
    <div class="copy-modal-backdrop" data-copy-modal-close></div>
    <div class="copy-modal-content">
      <h2 class="copy-modal-title" id="copyFallbackModalTitle">コピー</h2>
      <p class="copy-modal-description">テキストを選択してコピー</p>
      <textarea class="copy-modal-text" readonly></textarea>
      <div class="copy-modal-actions">
        <button class="copy-modal-close" type="button" data-copy-modal-close>閉じる</button>
      </div>
    </div>
  `;

  // 背景クリックまたは閉じるボタンクリックで閉じる
  modal.addEventListener('click', event => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    if (event.target.matches('[data-copy-modal-close]')) {
      hideCopyFallbackModal();
    }
  });

  // Escキーで閉じる
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideCopyFallbackModal();
    }
  });

  document.body.appendChild(modal);
  return modal;
}

// 編集モーダルを閉じた後にフォーカスを戻す要素を保存
let editModalLastActiveElement = null;

/**
 * 編集用モーダルを生成または取得
 *
 * @returns {HTMLElement} - 編集モーダル要素
 */
function ensureEditMessageModal() {
  let modal = document.getElementById('editMessageModal');
  if (modal) {
    return modal;
  }

  modal = document.createElement('div');
  modal.id = 'editMessageModal';
  modal.className = 'copy-modal edit-message-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'editMessageModalTitle');

  modal.innerHTML = `
    <div class="copy-modal-backdrop" data-edit-modal-close></div>
    <div class="copy-modal-content">
      <h2 class="copy-modal-title" id="editMessageModalTitle">メッセージを編集</h2>
      <textarea class="copy-modal-text edit-modal-text" data-edit-modal-text rows="6"></textarea>
      <div class="copy-modal-actions">
        <button class="copy-modal-close" type="button" data-edit-modal-close>キャンセル</button>
        <button class="copy-modal-save" type="button" data-edit-modal-save>更新</button>
      </div>
    </div>
  `;

  modal.addEventListener('click', event => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    if (event.target.closest('[data-edit-modal-close]')) {
      event.preventDefault();
      cancelMessageEdit();
      return;
    }

    if (event.target.closest('[data-edit-modal-save]')) {
      event.preventDefault();
      submitMessageEdit();
    }
  });

  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelMessageEdit();
      return;
    }

    if ((event.key === 'Enter' || event.key === 'NumpadEnter') && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitMessageEdit();
    }
  });

  const textarea = modal.querySelector('[data-edit-modal-text]');
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.addEventListener('input', () => autoResizeTextarea(textarea));
  }

  document.body.appendChild(modal);
  return modal;
}

/**
 * 編集モーダルを表示
 *
 * @param {Object} message - 編集対象メッセージ
 */
function showEditMessageModal(message) {
  const modal = ensureEditMessageModal();
  const textarea = modal.querySelector('[data-edit-modal-text]');
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }

  editModalLastActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  textarea.value = message?.Text || '';
  autoResizeTextarea(textarea);

  modal.dataset.editingUuid = message?.Uuid || '';
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => {
    textarea.focus();
    const length = textarea.value.length;
    textarea.setSelectionRange(length, length);
    autoResizeTextarea(textarea);
  });
}

/**
 * 編集モーダルを非表示
 *
 * @param {Object} [options]
 * @param {boolean} [options.restoreFocus=true] - フォーカス復元を行うか
 */
function hideEditMessageModal(options = {}) {
  const modal = document.getElementById('editMessageModal');
  if (!modal) {
    return;
  }

  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  modal.dataset.editingUuid = '';

  const textarea = modal.querySelector('[data-edit-modal-text]');
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.value = '';
    textarea.style.height = '40px';
    textarea.style.overflowY = 'hidden';
  }

  if (options.restoreFocus !== false && editModalLastActiveElement) {
    editModalLastActiveElement.focus();
  }

  editModalLastActiveElement = null;
}

/**
 * 編集モーダルでの更新確定処理
 */
async function submitMessageEdit() {
  if (!state.editingUuid) {
    cancelMessageEdit();
    return;
  }

  const modal = ensureEditMessageModal();
  const textarea = modal.querySelector('[data-edit-modal-text]');
  if (!(textarea instanceof HTMLTextAreaElement)) {
    cancelMessageEdit();
    return;
  }

  const saveBtn = modal.querySelector('[data-edit-modal-save]');
  if (saveBtn instanceof HTMLButtonElement) {
    saveBtn.disabled = true;
  }

  let result;
  try {
    result = await performMessageSend({ text: textarea.value, editingUuid: state.editingUuid });
  } catch (error) {
    console.error('Failed to update message:', error);
    if (error && typeof error === 'object' && error.__attachmentUploadFailed) {
      showAlertModal('添付ファイルのアップロードに失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。\n\n'+error, { title: 'エラー' });
    } else {
      showAlertModal('メッセージの更新に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。\n\n'+error , { title: 'エラー' });
    }
    return;
  } finally {
    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.disabled = false;
    }
  }

  if (!result?.sent) {
    return;
  }

  hideEditMessageModal({ restoreFocus: true });
  clearEditingState();
  clearAttachments();
  await reloadMessages({ forceScroll: true });
}

/**
 * 編集モーダルをキャンセル
 */
function cancelMessageEdit() {
  hideEditMessageModal({ restoreFocus: true });
  clearEditingState();
  clearAttachments();
}

/**
 * 編集状態をクリア
 *
 * 編集中のメッセージUUIDと添付ファイルIDをクリアし、UIを通常状態に戻します。
 */
function clearEditingState() {
  // 編集中のメッセージUUIDと添付ファイルIDをクリア
  state.editingUuid = null;
  state.editingAttachmentIds = [];

  // すべてのメッセージ要素から編集中スタイルを削除
  document
    .querySelectorAll('.message.editing')
    .forEach(elem => elem.classList.remove('editing'));

  refreshSendButton();
}

/**
 * メッセージを編集
 *
 * 指定したメッセージの内容を入力フィールドに読み込み、編集モードに入ります。
 * 編集できるのはユーザーメッセージのみで、既存の添付ファイルIDも保持します。
 *
 * @param {HTMLElement} btn - 編集ボタン要素
 */
function editMessage(btn) {
  const messageElem = btn.closest('.message');
  if (!messageElem) {
    return;
  }

  const uuid = messageElem.dataset.uuid;
  const target = state.messages.find(item => item.Uuid === uuid);
  if (!target) {
    return;
  }

  if (normalizeRole(target.Role) !== 'user' && normalizeRole(target.Role) !== 'chocolatelm') {
    showAlertModal('ユーザーメッセージのみ編集できます。', { title: '編集' });
    return;
  }

  hideEditMessageModal({ restoreFocus: false });
  clearEditingState();
  clearAttachments();

  state.editingUuid = uuid;
  state.editingAttachmentIds = normalizeAttachmentIds(target.AttachmentId);
  messageElem.classList.add('editing');

  refreshSendButton();

  if(normalizeRole(target.Role) === 'chocolatelm') {
    target.Text = ""; // ChocolateLMメッセージの編集時はテキストを空にする
  }

  showEditMessageModal(target);
}

/**
 * ツール詳細の表示/非表示を切り替え
 *
 * @param {HTMLElement} elem - クリックされたトグル要素
 */
function toggleToolDetails(elem) {
  // 次の要素（コンテンツ部分）を取得
  const content = elem.nextElementSibling;

  // 展開/折りたたみを切り替え
  content.classList.toggle('expanded');

  // アイコンを更新
  const icon = elem.querySelector('span');
  if (icon) {
    icon.textContent = content.classList.contains('expanded') ? '▼' : '▶';
  }
}

/**
 * メッセージ一覧を再読み込み
 *
 * サーバーから最新のメッセージ一覧と統計情報を取得し、画面を更新します。
 * ポーリングによって定期的に呼ばれるほか、メッセージ送信後にも実行されます。
 *
 * @param {Object} options - オプション
 * @param {boolean} options.forceScroll - 強制的に最下部にスクロールするか
 */
async function reloadMessages(options = {}) {
  // 下端に近い位置にいる場合、または強制スクロールの場合はスクロールを維持
  const shouldStick = options.forceScroll ? true : isNearBottom();

  try {
    // 初回読み込みまたは強制スクロールの場合は最新メッセージを取得
    if (options.forceScroll || state.messages.length === 0) {
      await loadLatestMessages({ scrollToBottom: true });
      return;
    }

    // 現在表示中の範囲を再取得
    const fetchIndex = state.messagesStartIndex;
    const fetchCount = Math.max(state.messages.length, 1);
    const { messages, total, stats, hash } = await fetchMessagesRange(fetchIndex, fetchCount);

    state.totalMessages = total;

    // メッセージが取得できなかった場合は最新メッセージを再取得
    if (messages.length === 0 && total > 0) {
      await loadLatestMessages({ scrollToBottom: shouldStick });
      updateInfoBar(stats);
      return;
    }

    // 下端に近く、かつ表示範囲外に新しいメッセージがある場合は最新メッセージを取得
    if (shouldStick && total > fetchIndex + messages.length) {
      await loadLatestMessages({ scrollToBottom: true });
      return;
    }

    // ハッシュが変更されたかチェック
    const nextHash = typeof hash === 'string' && hash.length > 0 ? hash : null;
    const prevHash = typeof state.messagesHash === 'string' && state.messagesHash.length > 0 ? state.messagesHash : null;
    const hasChanged = nextHash !== null && prevHash !== null ? nextHash !== prevHash : true;

    // 開始インデックスを再計算
    const nextStartIndex = Math.max(Math.min(fetchIndex, Math.max(total - messages.length, 0)), 0);
    state.messagesStartIndex = nextStartIndex;

    // 変更があった場合のみ状態を更新
    if (hasChanged) {
      state.messages = messages;
    }

    // 現在のハッシュを更新
    state.messagesHash = nextHash;

    // インデックスを正規化
    clampMessagesStartIndex();

    // 変更があった場合のみ再描画
    if (hasChanged) {
      renderMessages();
    }

    // 下端に近い場合は最下部にスクロール
    if (shouldStick) {
      scrollToBottom({ waitForImages: true });
    }

    // 情報バーを更新
    updateInfoBar(stats);
  } catch (error) {
    console.error('Failed to load messages:', error);
  }
}

/**
 * 情報バーを更新
 *
 * 統計情報（発言数、総数、切り捨て数など）を表示します。
 *
 * @param {Object} stats - 統計情報オブジェクト
 */
function updateInfoBar(stats) {
  const infoBar = document.getElementById('infoBar');
  if (!infoBar) {
    return;
  }

  // 統計情報が渡された場合は保存、なければ前回の情報を使用
  if (stats) {
    state.lastStats = stats;
  } else if (state.lastStats) {
    stats = state.lastStats;
  }

  // 統計情報がない場合は情報バーをクリア
  if (!stats) {
    infoBar.textContent = '';
    infoBar.classList.remove('warning');
    return;
  }

  const parts = [];
  const userLabel = state.userName || 'あなた';
  parts.push(`直近(8h)の${userLabel}の発言数: ${stats.UserLast8h ?? 0}`);
  parts.push(`履歴総数: ${stats.Total ?? 0}`);
  parts.push(`切捨数: ${stats.Archived ?? 0}`);

  // 発言数上限に達している場合は警告を表示
  if (stats.NeedUserRestRemind) {
    parts.push('上限超過<br>⚠ 設定された上限(8h)に達しました。休憩をおすすめします。');
    infoBar.classList.add('warning');
  } else {
    infoBar.classList.remove('warning');
  }

  infoBar.innerHTML = parts.join(' | ');
}

/**
 * スクロール位置が下端に近いかを判定
 *
 * 新しいメッセージが追加されたときに自動スクロールするかを決定するために使用します。
 *
 * @returns {boolean} - 下端に近い場合はtrue
 */
function isNearBottom() {
  const scroller = document.getElementById('chatMessages');
  if (!scroller) {
    return true;
  }

  const distance = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
  return distance <= AUTO_SCROLL_THRESHOLD;
}

/**
 * メッセージ一覧を画面に描画
 *
 * state.messagesに保存されているメッセージデータから
 * HTMLElementを作成してDOMに追加します。
 * 画像の読み込み待ちやスクロール位置の調整も行います。
 *
 * @param {Object} options - 描画オプション
 * @param {string|null} options.anchorUuid - スクロール位置を維持する基準となるメッセージUUID
 */
function renderMessages(options = {}) {
  const { anchorUuid = null } = options;
  const container = document.getElementById('messagesInner');
  const bottomSentinel = document.getElementById('bottomSentinel');
  const scroller = document.getElementById('chatMessages');

  if (!container || !bottomSentinel) {
    return;
  }

  // アンカー位置を保存（古いメッセージ読み込み時のスクロール位置維持用）
  let anchorOffsetBefore = null;
  if (anchorUuid && scroller) {
    // 基準となるメッセージ要素を取得
    const currentAnchor = container.querySelector(`.message[data-uuid="${anchorUuid}"]`);
    if (currentAnchor) {
      // スクロールコンテナとアンカー要素の位置を取得
      const scrollerRect = scroller.getBoundingClientRect();
      const anchorRect = currentAnchor.getBoundingClientRect();
      // スクロールコンテナ上端からのアンカー要素のオフセットを計算
      anchorOffsetBefore = anchorRect.top - scrollerRect.top;
    }
  }

  // 既存のメッセージ要素をすべて削除（再描画の準備）
  container.querySelectorAll('.message').forEach(elem => elem.remove());

  // DocumentFragmentを使用してパフォーマンスを向上（一度にDOMに追加）
  const fragment = document.createDocumentFragment();
  // 読み込み待ちの画像カウンターをリセット
  state.pendingImages = 0;

  let allMessages = Array.isArray(state.messages) ? state.messages : [];

  if (allMessages.length > 1) {
    const seenUuid = new Set();
    const deduped = [];
    let modified = false;

    for (const message of allMessages) {
      const uuid = typeof message?.Uuid === 'string' && message.Uuid ? message.Uuid : null;
      if (uuid && seenUuid.has(uuid)) {
        modified = true;
        continue;
      }

      if (uuid) {
        seenUuid.add(uuid);
      }

      deduped.push(message);
    }

    if (modified) {
      state.messages = deduped;
      allMessages = deduped;
    }
  }

  // すべてのメッセージをHTML要素に変換
  allMessages.forEach(message => {
    const element = createMessageElement(message);

    // メッセージ内のすべての画像要素を取得して読み込み監視
    element.querySelectorAll('img').forEach(img => {
      // まだ読み込みが完了していない画像をカウント
      if (!img.complete) {
        state.pendingImages += 1;

        // 画像の読み込み完了時の処理
        const finalize = () => {
          // カウンターをデクリメント
          if (state.pendingImages > 0) {
            state.pendingImages -= 1;
          }

          // すべての画像が読み込まれた場合
          if (state.pendingImages <= 0) {
            state.pendingImages = 0;
            // スクロールが遅延されている場合は実行
            if (state.deferScroll) {
              state.deferScroll = false;
              scrollToBottom();
            }
          }
        };

        // load/errorイベントをリスニング（一度だけ実行）
        img.addEventListener('load', finalize, { once: true });
        img.addEventListener('error', finalize, { once: true });
      }
    });
    // フラグメントに要素を追加
    fragment.appendChild(element);
  });

  // 画像がない、または全て読み込み済みの場合は即座にスクロール
  if (state.pendingImages === 0 && state.deferScroll) {
    state.deferScroll = false;
    scrollToBottom();
  }

  // フラグメント内のすべてのメッセージをDOMに一度に追加
  container.insertBefore(fragment, bottomSentinel);

  // アンカー位置を復元（スクロール位置を維持）
  if (anchorUuid && scroller && anchorOffsetBefore !== null) {
    // 再描画後のアンカー要素を取得
    const updatedAnchor = container.querySelector(`.message[data-uuid="${anchorUuid}"]`);
    if (updatedAnchor) {
      // 新しい位置を計算
      const scrollerRectAfter = scroller.getBoundingClientRect();
      const anchorRectAfter = updatedAnchor.getBoundingClientRect();
      const anchorOffsetAfter = anchorRectAfter.top - scrollerRectAfter.top;
      // スクロール位置を調整してアンカーを同じ位置に保つ
      scroller.scrollTop += anchorOffsetAfter - anchorOffsetBefore;
    }
  }

  renderLiveGenerationMessage();
}

/**
 * ライブ生成ステータスのラベルを取得
 *
 * AI応答生成のステータス値を日本語のラベルに変換します。
 *
 * @param {string} status - ステータス値（started, generating, completed, canceledなど）
 * @returns {string} - 日本語のステータスラベル
 */
function getLiveStatusLabel(status) {
  switch ((status || '').toLowerCase()) {
    case 'started':
      return '思考開始';
    case 'generating':
      return '生成中';
    case 'completed':
      return '生成完了';
    case 'canceled':
      return 'キャンセル';
    case 'tool_update':
      return 'ツール実行中';
    default:
      return '更新';
  }
}

/**
 * ライブ生成メッセージを描画
 *
 * AI応答生成中のメッセージをリアルタイムで画面に表示します。
 * 既存のライブ生成メッセージがあれば更新し、なければ新規作成します。
 * 生成が完了またはキャンセルされた場合は、メッセージを削除します。
 */
function renderLiveGenerationMessage() {
  const container = document.getElementById('messagesInner');
  const bottomSentinel = document.getElementById('bottomSentinel');

  if (!container || !bottomSentinel) {
    return;
  }

  const existing = document.getElementById('liveGenerationMessage');

  if (!state.liveGeneration) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  const statusKey = (state.liveGeneration.status || '').toLowerCase();
  const needsPlaceholder = state.liveGeneration.status === 'generating' || state.liveGeneration.status === 'started';
  const displayText = state.liveGeneration.text && state.liveGeneration.text.length > 0
    ? state.liveGeneration.text
    : needsPlaceholder
      ? '...'
      : '';

  if (existing) {
    existing.classList.add('live-generation');

    const textElement = existing.querySelector('.message-text');
    if (textElement) {
      textElement.innerHTML = formatMessageText(displayText);
    }

    updateLiveStatusBadge(existing, statusKey);
  } else {
    const message = {
      Uuid: 'live-generation',
      Role: 'assistant',
      Text: displayText,
      Reasoning: '',
      ToolDetail: '',
      AttachmentId: null,
      Timestamp: Math.floor(Date.now() / 1000)
    };

    const element = createMessageElement(message);
    element.id = 'liveGenerationMessage';
    element.classList.add('live-generation');
    updateLiveStatusBadge(element, statusKey);
    container.insertBefore(element, bottomSentinel);
  }

  if (statusKey === 'generating') {
    scrollToBottom({ deferOnly: true });
  }
}

/**
 * ライブステータスバッジを作成または取得
 *
 * メッセージ要素にライブステータスバッジが存在しない場合は新規作成し、
 * 存在する場合はそれを返します。バッジはインジケーターとラベルで構成されます。
 *
 * @param {HTMLElement} element - メッセージ要素
 * @returns {HTMLElement} - ステータスバッジ要素
 */
function ensureLiveStatusBadge(element) {
  // 既存のバッジを検索
  let badge = element.querySelector('.live-status-badge');
  if (!badge) {
    // バッジが存在しない場合は新規作成
    badge = document.createElement('span');
    badge.className = 'live-status-badge';

    // インジケーター（アニメーションする点）を作成
    const indicator = document.createElement('span');
    indicator.className = 'live-status-indicator';
    badge.appendChild(indicator);

    // ラベル（テキスト）を作成
    const label = document.createElement('span');
    label.className = 'live-status-label';
    badge.appendChild(label);

    // メッセージヘッダーに追加
    const header = element.querySelector('.message-header');
    if (header) {
      header.appendChild(badge);
    }
  }
  return badge;
}

/**
 * ライブステータスバッジを更新
 *
 * AI応答生成のステータスに応じて、バッジのラベルとスタイルを更新します。
 * キャンセル時は特別なスタイルを適用します。
 *
 * @param {HTMLElement} element - メッセージ要素
 * @param {string} statusKey - ステータスキー（started, generating, completed, canceledなど）
 */
function updateLiveStatusBadge(element, statusKey) {
  // バッジを取得または作成
  const badge = ensureLiveStatusBadge(element);
  if (!badge) {
    return;
  }

  // インジケーター要素を取得または作成
  const indicator = badge.querySelector('.live-status-indicator') || document.createElement('span');
  if (!indicator.classList.contains('live-status-indicator')) {
    indicator.className = 'live-status-indicator';
    badge.insertBefore(indicator, badge.firstChild || null);
  }

  // ラベル要素を取得または作成
  const label = badge.querySelector('.live-status-label') || document.createElement('span');
  if (!label.classList.contains('live-status-label')) {
    label.className = 'live-status-label';
    badge.appendChild(label);
  }

  // ラベルテキストを更新
  label.textContent = getLiveStatusLabel(statusKey);

  // キャンセル時は特別なスタイルを適用
  if (statusKey === 'canceled') {
    badge.classList.add('canceled');
  } else {
    badge.classList.remove('canceled');
  }
}

/**
 * 指定範囲のメッセージをサーバーから取得
 *
 * インデックスと件数を指定してメッセージの範囲を取得します。
 * 負のインデックスを指定すると末尾からの相対位置として扱われます。
 *
 * @param {number} index - 開始インデックス（負の値の場合は末尾からの相対位置）
 * @param {number} count - 取得する件数
 * @returns {Promise<Object>} - { messages: メッセージ配列, total: 総数, stats: 統計情報 }
 */
async function fetchMessagesRange(index, count) {
  // パラメータの妥当性チェック
  if (!Number.isFinite(index) || !Number.isFinite(count) || count <= 0) {
    return { messages: [], total: state.totalMessages, stats: state.lastStats };
  }

  // クエリパラメータを構築
  const params = new URLSearchParams();
  params.set('index', String(index));
  params.set('count', String(count));

  // サーバーからメッセージを取得
  const data = await fetchJson(`/api/persona/active/message?${params.toString()}`);

  // レスポンスデータを正規化
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : messages.length;
  const hash = typeof data?.hash === 'string' && data.hash.length > 0 ? data.hash : null;

  return {
    messages,
    total,
    stats: data?.stats ?? null,
    hash
  };
}

/**
 * 最新のメッセージを読み込み
 *
 * メッセージ履歴の末尾（最新）からINITIAL_VISIBLE_COUNT件を読み込みます。
 * 初回読み込み時や、最新メッセージにジャンプする場合に使用します。
 *
 * @param {Object} options - オプション
 * @param {boolean} options.scrollToBottom - 読み込み後に最下部までスクロールするか
 */
async function loadLatestMessages(options = {}) {
  const { scrollToBottom: shouldScroll = false } = options;

  // 負のインデックスで末尾から相対的に取得
  const { messages, total, stats, hash } = await fetchMessagesRange(-INITIAL_VISIBLE_COUNT, INITIAL_VISIBLE_COUNT);

  // メッセージが取得できなかった場合のフォールバック処理
  if (messages.length === 0 && total > 0) {
    // 正のインデックスで再試行
    const startIndex = Math.max(total - INITIAL_VISIBLE_COUNT, 0);
    const fallback = await fetchMessagesRange(startIndex, INITIAL_VISIBLE_COUNT);

    // 状態を更新
    state.messages = fallback.messages;
    state.totalMessages = fallback.total;
    state.messagesStartIndex = Math.max(fallback.total - fallback.messages.length, 0);
    state.messagesHash = typeof fallback.hash === 'string' && fallback.hash.length > 0 ? fallback.hash : null;

    // インデックスを正規化
    clampMessagesStartIndex();

    // 画面を更新
    renderMessages();
    if (shouldScroll) {
      scrollToBottom({ waitForImages: true });
    }
    updateInfoBar(fallback.stats ?? stats);
    return;
  }

  // 状態を更新
  state.messages = messages;
  state.totalMessages = total;
  state.messagesStartIndex = Math.max(total - messages.length, 0);
  state.messagesHash = typeof hash === 'string' && hash.length > 0 ? hash : null;

  // インデックスを正規化
  clampMessagesStartIndex();

  // 画面を更新
  renderMessages();
  if (shouldScroll) {
    scrollToBottom({ waitForImages: true });
  }

  updateInfoBar(stats);
}

/**
 * より古いメッセージを読み込み（上スクロール時）
 *
 * 現在表示している範囲より前のメッセージをstep件取得します。
 * IntersectionObserverで上端センチネルが見えたときに呼ばれます。
 *
 * @param {number} step - 取得する件数（デフォルト: VISIBLE_INCREMENT）
 * @returns {Promise<boolean>} - 読み込みに成功した場合true
 */
async function loadOlderMessages(step = VISIBLE_INCREMENT) {
  // これ以上古いメッセージがない、またはメッセージが空の場合
  if (state.messagesStartIndex <= 0 || state.messages.length === 0) {
    return false;
  }

  // 新しい開始インデックスを計算
  const newStart = Math.max(state.messagesStartIndex - step, 0);
  const fetchCount = state.messagesStartIndex - newStart;
  if (fetchCount <= 0) {
    return false;
  }

  // スクロール位置維持のためのアンカー（現在の先頭メッセージ）
  const anchorUuid = state.messages[0]?.Uuid || null;

  // サーバーから古いメッセージを取得
  const { messages: fetched, total, stats } = await fetchMessagesRange(newStart, fetchCount);

  state.totalMessages = total;

  // 取得できなかった場合
  if (fetched.length === 0) {
    state.messagesStartIndex = newStart;
    updateInfoBar(stats);
    return false;
  }

  // 取得したメッセージを既存のメッセージの前に結合
  let combined = fetched.concat(state.messages);

  // 表示件数の上限を超える場合は末尾を切り捨て
  if (combined.length > INITIAL_VISIBLE_COUNT) {
    combined = combined.slice(0, INITIAL_VISIBLE_COUNT);
  }

  // 状態を更新
  state.messages = combined;
  state.messagesStartIndex = newStart;
  clampMessagesStartIndex();
  state.messagesHash = null;

  // アンカーUUIDを指定して再描画（スクロール位置を維持）
  renderMessages({ anchorUuid });
  updateInfoBar(stats);
  return true;
}

/**
 * より新しいメッセージを読み込み（下スクロール時）
 *
 * 現在表示している範囲より後のメッセージをstep件取得します。
 * IntersectionObserverで下端センチネルが見えたときに呼ばれます。
 *
 * @param {number} step - 取得する件数（デフォルト: VISIBLE_INCREMENT）
 * @returns {Promise<boolean>} - 読み込みに成功した場合true
 */
async function loadNewerMessages(step = VISIBLE_INCREMENT) {
  // メッセージが空の場合
  if (state.messages.length === 0) {
    return false;
  }

  // 現在の表示範囲の終端インデックスを計算
  const currentEnd = state.messagesStartIndex + state.messages.length;

  // スクロール位置維持のためのアンカー（現在の末尾メッセージ）
  const anchorUuid = state.messages[state.messages.length - 1]?.Uuid || null;

  // サーバーから新しいメッセージを取得
  const { messages: fetched, total, stats } = await fetchMessagesRange(currentEnd, step);

  state.totalMessages = total;

  // 取得できなかった場合（これ以上新しいメッセージがない）
  if (fetched.length === 0) {
    updateInfoBar(stats);
    return false;
  }

  // 取得したメッセージを既存のメッセージの後ろに結合
  let combined = state.messages.concat(fetched);

  // 表示件数の上限を超える場合は先頭を切り捨て
  if (combined.length > INITIAL_VISIBLE_COUNT) {
    const dropCount = combined.length - INITIAL_VISIBLE_COUNT;
    combined = combined.slice(dropCount);
    // 開始インデックスも調整
    state.messagesStartIndex += dropCount;
  }

  // 状態を更新
  state.messages = combined;
  clampMessagesStartIndex();
  state.messagesHash = null;

  // アンカーUUIDを指定して再描画（スクロール位置を維持）
  renderMessages({ anchorUuid });
  updateInfoBar(stats);
  return true;
}

/**
 * メッセージ開始インデックスを有効な範囲に補正
 *
 * state.messagesStartIndexが総メッセージ数と表示中のメッセージ数から
 * 計算される有効範囲を超えないように調整します。
 */
function clampMessagesStartIndex() {
  // メッセージが空の場合はインデックスを0にリセット
  if (state.messages.length === 0) {
    state.messagesStartIndex = 0;
    return;
  }

  // 開始インデックスの最大値を計算（総数 - 表示中の件数）
  const maxStart = Math.max(state.totalMessages - state.messages.length, 0);

  // 最大値を超えている場合は補正
  if (state.messagesStartIndex > maxStart) {
    state.messagesStartIndex = maxStart;
  }

  // 負の値になっている場合は0に補正
  if (state.messagesStartIndex < 0) {
    state.messagesStartIndex = 0;
  }
}

// IntersectionObserverのインスタンス（仮想スクロール用）
// 上端・下端のセンチネル要素を監視し、表示範囲外のメッセージを動的に読み込む
let topObserver = null;     // 上端センチネル用オブザーバー（古いメッセージ読み込み）
let bottomObserver = null;  // 下端センチネル用オブザーバー（新しいメッセージ読み込み）

// メッセージウィンドウ調整中フラグ（多重実行防止）
// 同時に複数の読み込み処理が走らないようにするためのロック
let isAdjustingWindow = false;

/**
 * 上端センチネルの交差イベントハンドラー
 *
 * ユーザーが上にスクロールして上端センチネルが見えた場合、
 * より古いメッセージを読み込みます。
 *
 * @param {IntersectionObserverEntry[]} entries - 交差エントリー配列
 */
function handleTopIntersection(entries) {
  // センチネルが見えていない場合は何もしない
  if (!entries.some(entry => entry.isIntersecting)) {
    return;
  }

  // 調整中、メッセージが空、または先頭に到達している場合は何もしない
  if (isAdjustingWindow || state.messages.length === 0 || state.messagesStartIndex <= 0) {
    return;
  }

  // 調整中フラグを立てて古いメッセージを読み込み
  isAdjustingWindow = true;
  loadOlderMessages()
    .catch(error => console.error('Failed to load older messages:', error))
    .finally(() => {
      // 完了後にフラグを解除
      isAdjustingWindow = false;
    });
}

/**
 * 下端センチネルの交差イベントハンドラー
 *
 * ユーザーが下にスクロールして下端センチネルが見えた場合、
 * より新しいメッセージを読み込みます。
 *
 * @param {IntersectionObserverEntry[]} entries - 交差エントリー配列
 */
function handleBottomIntersection(entries) {
  // センチネルが見えていない場合は何もしない
  if (!entries.some(entry => entry.isIntersecting)) {
    return;
  }

  // 調整中、またはメッセージが空の場合は何もしない
  if (isAdjustingWindow || state.messages.length === 0) {
    return;
  }

  // 調整中フラグを立てて新しいメッセージを読み込み
  isAdjustingWindow = true;
  loadNewerMessages()
    .catch(error => console.error('Failed to load newer messages:', error))
    .finally(() => {
      // 完了後にフラグを解除
      isAdjustingWindow = false;
    });
}

/**
 * スクロールオブザーバーをセットアップ
 *
 * IntersectionObserverを使用して、上端・下端のセンチネル要素が
 * 画面内に入ったときに自動的にメッセージを読み込む仕組みを構築します。
 * これにより、仮想スクロール（無限スクロール）を実現します。
 */
function setupScrollObservers() {
  // 必要なDOM要素を取得
  const scroller = document.getElementById('chatMessages');
  const topSentinel = document.getElementById('topSentinel');
  const bottomSentinel = document.getElementById('bottomSentinel');

  // 要素が見つからない場合は何もしない
  if (!scroller || !topSentinel || !bottomSentinel) {
    return;
  }

  // IntersectionObserverのオプション設定
  const options = {
    root: scroller,      // 監視のルート要素（スクロールコンテナ）
    threshold: 0.1       // センチネルの10%が見えたら発火
  };

  // 既存のオブザーバーがあれば解除（二重登録防止）
  if (topObserver) {
    topObserver.disconnect();
  }
  if (bottomObserver) {
    bottomObserver.disconnect();
  }

  // 新しいオブザーバーを作成
  topObserver = new IntersectionObserver(handleTopIntersection, options);
  bottomObserver = new IntersectionObserver(handleBottomIntersection, options);

  // センチネル要素の監視を開始
  topObserver.observe(topSentinel);
  bottomObserver.observe(bottomSentinel);
}

/**
 * ロールに応じたペルソナアイコンURLを取得
 *
 * @param {string} roleKey - 標準化されたロールキー
 * @returns {string|null} - アイコンのオブジェクトURL
 */
function getPersonaAvatarUrl(roleKey) {
  switch (roleKey) {
    case 'user':
      return state.personaMedia.userAvatar;
    case 'assistant':
      return state.personaMedia.assistantAvatar;
    default:
      return null;
  }
}

/**
 * メッセージ要素を作成
 *
 * メッセージデータからHTMLElementを生成します。
 *
 * @param {Object} message - メッセージオブジェクト
 * @returns {HTMLElement} - メッセージ要素
 */
function createMessageElement(message) {
  // ロール情報を取得
  const roleKey = normalizeRole(message.Role);
  const meta = getRoleMeta(roleKey);
  const avatarUrl = getPersonaAvatarUrl(roleKey);
  const avatarHtml = avatarUrl
    ? `<div class="message-avatar has-image" style="background-image: url('${avatarUrl}');"></div>`
    : `<div class="message-avatar">${meta.icon}</div>`;

  // メッセージ要素を作成
  const element = document.createElement('div');
  element.className = `message ${meta.className}`;
  element.dataset.uuid = message.Uuid;

  // 各種データを整形
  const timestamp = formatTimestamp(message.Timestamp);
  const messageBody = formatMessageText(message.Text);
  // 推論内容がある場合は表示
  const reasoning = message.Reasoning
    ? `<div class="message-reasoning">${renderMarkdown(message.Reasoning)}</div>`
    : '';
  const toolDetails = renderToolDetail(parseToolDetail(message.ToolDetail));
  const attachmentBlock = renderAttachment(message.AttachmentId);
  const actions = renderMessageActions(roleKey);

  // HTMLを組み立て
  element.innerHTML = `
    ${avatarHtml}
    <div class="message-content">
      <div class="message-header">
        <span class="message-name">${escapeHtml(meta.label)}</span>
        <span class="message-time">${escapeHtml(timestamp)}</span>
      </div>
      <div class="message-text">${messageBody}</div>
      ${reasoning}
      ${attachmentBlock}
      ${toolDetails}
      ${actions}
    </div>
  `;

  // 編集中の場合はスタイルを追加
  if (state.editingUuid && state.editingUuid === message.Uuid) {
    element.classList.add('editing');
  }

  return element;
}

/**
 * メッセージアクションボタンを描画
 *
 * @param {string} roleKey - ロールキー
 * @returns {string} - アクションボタンのHTML
 */
function renderMessageActions(roleKey) {
  // すべてのメッセージにコピーボタンを追加
  const copyButton = `
    <button class="message-btn" onclick="copyMessage(this)" title="コピー">
      <svg viewBox="0 0 24 24">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
  `;

  const buttons = [copyButton];

  // ユーザーメッセージには編集ボタンも追加
  if (roleKey === 'user' || roleKey === 'chocolatelm') {
    buttons.push(`
      <button class="message-btn" onclick="editMessage(this)" title="編集">
        <svg viewBox="0 0 24 24">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
    `);
  }

  return `<div class="message-actions">${buttons.join('')}</div>`;
}

/**
 * 添付ファイル情報を描画
 *
 * @param {any} attachmentValue - 添付ファイルID（単一または配列）
 * @returns {string} - 添付ファイルブロックのHTML
 */
function renderAttachment(attachmentValue) {
  // 添付ファイルがない場合は空文字を返す
  if (attachmentValue === null || typeof attachmentValue === 'undefined') {
    return '';
  }

  // 単一値または配列を配列として正規化
  const ids = normalizeAttachmentIds(attachmentValue);

  // 有効なIDがない場合は空文字を返す
  if (ids.length === 0) {
    return '';
  }

  // 各IDに対するダウンロードリンクを生成
  const links = ids
    .map(id => {
      const url = `/api/persona/active/attachment/${id}`;
      return `<div><a href="${url}" target="_blank" rel="noopener noreferrer">添付ファイル #${id}</a></div>`;
    })
    .join('');

  // 各IDに対する画像プレビューを生成
  const images = ids
    .map(id => {
      const url = `/api/persona/active/attachment/${id}`;
      return `
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="attachment-image-link">
          <img src="${url}" alt="添付画像 #${id}" loading="lazy">
        </a>
      `;
    })
    .join('');

  // 画像プレビューセクションを組み立て
  const imagesBlock = images
    ? `<div class="attachment-images">${images}</div>`
    : '';

  // ダウンロードリンクセクションを組み立て
  const linksBlock = links
    ? `<div class="attachment-links">${links}</div>`
    : '';

  // 全体のHTMLを返す
  return `
    <div class="message-attachment">
      ${imagesBlock}
      ${linksBlock}
    </div>
  `;
}

/**
 * 添付IDを配列に正規化
 *
 * サーバーから返される添付ファイルIDは単一値または配列の可能性があるため、
 * 常に配列形式に統一します。また、数値以外の値は除外します。
 *
 * @param {any} value - 添付ファイルID（単一値、配列、またはnull/undefined）
 * @returns {number[]} - 数値の配列
 */
function normalizeAttachmentIds(value) {
  // 配列でない場合は配列に変換（null/undefinedは空配列）
  const list = Array.isArray(value) ? value : value == null ? [] : [value];

  // 数値に変換し、有効な数値のみをフィルタリング
  return list
    .map(item => Number(item))
    .filter(item => Number.isFinite(item));
}

/**
 * ツール詳細情報をパース
 * 文字列の場合はJSONパースを試み、失敗した場合はそのまま返す
 * @param {*} raw - 生のツール詳細データ
 * @returns {*} - パースされたツール詳細
 */
function parseToolDetail(raw) {
  // ツール詳細がnullまたはundefinedの場合
  if (raw == null) {
    return null;
  }

  // 既にオブジェクトの場合はそのまま返す
  if (typeof raw === 'object') {
    return raw;
  }

  // 文字列の場合はJSONパースを試行
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.warn('Failed to parse tool detail JSON:', error);
      return trimmed;
    }
  }

  return raw;
}

/**
 * ツール詳細情報をHTML形式で描画
 * @param {*} toolDetail - ツール詳細データ
 * @returns {string} - ツール詳細ブロックのHTML
 */
function renderToolDetail(toolDetail) {
  // ツール詳細がない場合は空文字を返す
  if (toolDetail == null) {
    return '';
  }

  let serialized;

  // 文字列の場合
  if (typeof toolDetail === 'string') {
    const trimmed = toolDetail.trim();
    // 空文字列の場合は何も表示しない
    if (!trimmed) {
      return '';
    }
    serialized = trimmed;
  } else {
    try {
      serialized = JSON.stringify(toolDetail, null, 2);
    } catch (error) {
      console.warn('Failed to stringify tool detail:', error);
      serialized = String(toolDetail);
    }
  }

  const json = escapeHtml(serialized);

  return `
    <div class="tool-details">
      <div class="tool-toggle" onclick="toggleToolDetails(this)">ツール詳細 <span>▶</span></div>
      <div class="tool-content">${json}</div>
    </div>
  `;
}

/**
 * HTMLエスケープ
 *
 * XSS攻撃を防ぐため、HTMLの特殊文字をエスケープします。
 *
 * @param {string} text - エスケープする文字列
 * @returns {string} - エスケープされた文字列
 */
function escapeHtml(text) {
  // テキストがnullまたはundefinedの場合は空文字を返す
  if (text == null) {
    return '';
  }

  // HTML特殊文字をエスケープ
  return text
    .replace(/&/g, '&amp;')    // & → &amp;
    .replace(/</g, '&lt;')     // < → &lt;
    .replace(/>/g, '&gt;')     // > → &gt;
    .replace(/"/g, '&quot;')   // " → &quot;
    .replace(/'/g, '&#39;');   // ' → &#39;
}

/**
 * メッセージテキストをフォーマット
 *
 * Markdown形式のテキストをHTMLに変換します。
 *
 * @param {string} text - フォーマットするテキスト
 * @returns {string} - フォーマットされたHTML文字列
 */
function formatMessageText(text) {
  // 特定用途のタグをMarkdown形式に置換
  text = text.replaceAll("<system>", "`").replaceAll("</system>", "`").replaceAll("</think>", "");
  return renderMarkdown(text || '');
}

/**
 * MarkdownテキストをサニタイズしてHTMLに変換
 *
 * marked.jsが利用可能な場合はMarkdownをHTMLに変換し、
 * DOMPurifyでXSS対策のサニタイズを行います。
 * リンクにはセキュリティ属性（target="_blank" rel="noopener noreferrer"）を自動付与します。
 * marked.jsが利用できない場合はエスケープ後に改行を<br>に変換します。
 *
 * @param {string} text - 変換するMarkdownテキスト
 * @returns {string} - サニタイズ済みのHTML文字列
 */
function renderMarkdown(text) {
  // テキストが空の場合は空文字を返す
  if (!text) {
    return '';
  }

  try {
    // MarkdownをHTMLに変換
  const rawHtml = marked.parse(text);
  const sanitized = DOMPurify.sanitize(rawHtml, {
      RETURN_TRUSTED_TYPE: false
    });

    // ブラウザ環境の場合、すべてのリンクにセキュリティ属性を追加
    if (typeof document !== 'undefined') {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = sanitized;

      // すべてのリンク要素に対してセキュリティ設定を適用
      wrapper.querySelectorAll('a').forEach(anchor => {
        // 新しいタブで開く（元のタブへの影響を防ぐ）
        anchor.target = '_blank';

        // rel属性を取得して解析
        const relAttr = anchor.getAttribute('rel') || '';
        const relParts = relAttr.split(/\s+/).filter(Boolean);

        // noopenerを追加（window.openerアクセスを防止してセキュリティリスクを低減）
        if (!relParts.includes('noopener')) {
          relParts.push('noopener');
        }

        // noreferrerを追加（リファラー情報の送信を防止してプライバシー保護）
        if (!relParts.includes('noreferrer')) {
          relParts.push('noreferrer');
        }

        // 更新したrel属性を設定
        anchor.rel = relParts.join(' ');
      });

      return wrapper.innerHTML;
    }

    // ブラウザ環境でない場合（サーバーサイドレンダリングなど）はサニタイズ済みHTMLをそのまま返す
    return sanitized;
  } catch (error) {
    // Markdown変換エラー時はプレーンテキストとして処理
    console.error('Failed to render markdown:', error);
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

/**
 * チャット画面を最下部にスクロール
 *
 * 新しいメッセージが追加されたときや、初回読み込み時に
 * 画面を最下部までスクロールします。
 * 画像の読み込み待ちを考慮したオプションも指定できます。
 *
 * @param {Object} options - スクロールオプション
 * @param {boolean} options.waitForImages - 画像の読み込み完了を待つか（true の場合、画像読み込み後に再度スクロール）
 * @param {boolean} options.deferOnly - 次のフレームのみ待つか（DOM更新を1フレームだけ待つ）
 */
function scrollToBottom(options = {}) {
  const wantsImageWait = Boolean(options.waitForImages);
  const hasPendingImages = state.pendingImages > 0;

  // スクロールを実行する内部関数
  const apply = () => {
    const scroller = document.getElementById('chatMessages');
    if (!scroller) {
      return;
    }
    // scrollTopをscrollHeightに設定して最下部へスクロール
    scroller.scrollTop = scroller.scrollHeight;
  };

  // 2フレーム後にスクロールを実行（DOMの更新とレイアウト計算を確実に待つ）
  const scheduleDoubleFrame = () => {
    requestAnimationFrame(() => {
      apply();
      // さらに次のフレームでも実行（画像やレイアウトの高さ計算の遅延に対応）
      requestAnimationFrame(apply);
    });
  };

  // 画像の読み込み待ちが必要で、まだ読み込み中の画像がある場合
  if (wantsImageWait && hasPendingImages) {
    // スクロールを遅延させるフラグを立てる（画像読み込み完了時に再実行される）
    state.deferScroll = true;
    // 先に現在の内容で末尾に揃えておく（画像読み込み前の暫定スクロール）
    scheduleDoubleFrame();
    return;
  }

  // deferOnlyオプション時は1フレームのみ待つ（軽量な遅延スクロール）
  if (options.deferOnly) {
    requestAnimationFrame(apply);
    return;
  }

  // 通常は2フレーム待ってスクロール（確実なレイアウト反映のため）
  scheduleDoubleFrame();
}

// ポーリングタイマーのハンドル
// setIntervalの戻り値を保持し、ポーリングの開始/停止を管理
let pollingHandle = null;

/**
 * ポーリングを開始
 *
 * WebSocketが利用できない環境、または接続が切断された際のフォールバックとして、
 * 定期的にサーバーからメッセージを取得するポーリングを開始します。
 *
 * @param {Object} options - オプション
 * @param {boolean} options.immediate - 開始時に即座にメッセージを取得するか
 */
function startPolling(options = {}) {
  // 既にポーリングが開始されている場合は何もしない
  if (pollingHandle) {
    return;
  }

  // ポーリング実行時の処理（送信中や調整中でない場合のみメッセージを再読み込み）
  const execute = () => {
    if (!state.isSending && !isAdjustingWindow) {
      reloadMessages();
    }
  };

  // immediateオプションが指定されている場合は即座に実行
  if (options.immediate) {
    execute();
  }

  // 定期実行を開始（POLLING_INTERVAL_MS間隔）
  pollingHandle = setInterval(execute, POLLING_INTERVAL_MS);
}

/**
 * ポーリングを停止
 *
 * 定期的なメッセージ取得を停止します。
 * WebSocket接続が確立された際に呼び出されます。
 */
function stopPolling() {
  // ポーリングが開始されていない場合は何もしない
  if (!pollingHandle) {
    return;
  }
  // タイマーをクリアしてポーリングを停止
  clearInterval(pollingHandle);
  pollingHandle = null;
}

/**
 * リアルタイム通信を開始
 *
 * WebSocket接続を確立し、サーバーからのリアルタイム更新を受信できるようにします。
 * WebSocketが利用できない環境では、フォールバックとしてポーリングを使用します。
 * 初期化時（init関数内）から呼び出されます。
 */
function startRealtime() {
  // 再接続を有効化
  state.websocketShouldReconnect = true;

  // WebSocketがサポートされていない環境の場合、ポーリングにフォールバック
  if (typeof WebSocket === 'undefined') {
    console.warn('WebSocket is not supported in this environment. Falling back to polling.');
    startPolling({ immediate: false });
    return;
  }

  // WebSocketとポーリングの両方を開始（WebSocket切断時の保険としてポーリングも併用）
  startPolling({ immediate: false });
  connectWebSocket();
}

/**
 * WebSocket接続が確立されているか確認し、必要に応じて再接続
 *
 * タブがアクティブになった際や、定期的な接続チェック時に呼び出されます。
 * pingタイムアウトが発生している場合は再接続を試みます。
 */
function ensureWebSocketConnected() {
  console.log('Ensuring WebSocket connection...');

  // 再接続が無効化されている場合は何もしない
  if (!state.websocketShouldReconnect) {
    return;
  }

  // WebSocketがサポートされていない環境の場合、ポーリングを使用
  if (typeof WebSocket === 'undefined') {
    startPolling({ immediate: true });
    return;
  }

  // WebSocketインスタンスの状態を確認
  const ws = state.websocket;
  const hasWebSocketInstance = ws && typeof ws.readyState === 'number';
  const readyState = hasWebSocketInstance ? ws.readyState : WebSocket.CLOSED;
  const isOpen = readyState === WebSocket.OPEN;
  const isConnecting = readyState === WebSocket.CONNECTING;

  // WebSocketインスタンスが存在しないか、接続中でも開いてもいない場合は再接続
  if (!hasWebSocketInstance || (!isOpen && !isConnecting)) {
    connectWebSocket();
    return;
  }

  // pingタイムアウトの確認（猶予期間はタイムアウトの2倍）
  const hasPingTimestamp = Number.isFinite(state.lastPingReceivedAt) && state.lastPingReceivedAt > 0;
  const pingGracePeriod = WS_PING_TIMEOUT_MS * 2;

  // 最後のping受信から猶予期間を超えている場合は接続が切れているとみなして再接続
  if (hasPingTimestamp && Date.now() - state.lastPingReceivedAt > pingGracePeriod) {
    try {
      ws.close();
    } catch (error) {
      console.warn('Failed to close stale WebSocket before reconnect:', error);
    }
    connectWebSocket();
  }
}

/**
 * WebSocket接続を確立
 *
 * サーバーとのWebSocket接続を開始し、リアルタイム通信を有効にします。
 * 既存の接続がある場合は、まず切断してから新しい接続を確立します。
 * 接続に失敗した場合は自動的に再接続をスケジュールします。
 */
function connectWebSocket() {
  // 再接続タイマーをクリア
  clearWebSocketReconnectTimer();

  // 既存のWebSocket接続がある場合はクリーンアップ
  const previous = state.websocket;
  if (previous) {
    // イベントリスナーを削除
    previous.removeEventListener('open', handleWebSocketOpen);
    previous.removeEventListener('message', handleWebSocketMessage);
    previous.removeEventListener('close', handleWebSocketClosed);
    previous.removeEventListener('error', handleWebSocketError);
    state.websocket = null;

    // 既存の接続を閉じる
    try {
      previous.close();
    } catch (error) {
      console.warn('Failed to close existing WebSocket before reconnect:', error);
    }
  }

  // WebSocketのプロトコル（ws or wss）を決定（HTTPSの場合はwssを使用）
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws`;

  // WebSocket接続を初期化
  let socket;
  try {
    socket = new WebSocket(url);
  } catch (error) {
    console.error('WebSocket connection failed to initialize:', error);
    state.websocketStatus = 'error';
    scheduleWebSocketReconnect();
    return;
  }

  // 状態を更新
  state.websocket = socket;
  state.websocketStatus = 'connecting';

  // イベントリスナーを登録
  socket.addEventListener('open', handleWebSocketOpen);
  socket.addEventListener('message', handleWebSocketMessage);
  socket.addEventListener('close', handleWebSocketClosed);
  socket.addEventListener('error', handleWebSocketError);
}

/**
 * WebSocket接続が確立された際のハンドラー
 *
 * 接続成功時に呼ばれ、再接続カウンターをリセットし、
 * ポーリングを停止してping監視を開始します。
 */
function handleWebSocketOpen() {
  // 再接続タイマーをクリア
  clearWebSocketReconnectTimer();

  // 状態を更新
  state.websocketStatus = 'connected';
  state.websocketReconnectAttempts = 0;
  state.lastPingReceivedAt = Date.now();

  // WebSocketが確立されたのでポーリングを停止
  stopPolling();

  // ping監視を開始（サーバーからの定期的なpingメッセージを監視）
  startPingMonitor();
}

/**
 * WebSocket接続が切断された際のハンドラー
 *
 * 接続が切断されたときに呼ばれ、ping監視を停止し、
 * イベントリスナーをクリーンアップします。
 * 再接続が有効な場合は、ポーリングにフォールバックして再接続をスケジュールします。
 */
function handleWebSocketClosed() {
  // ping監視を停止
  stopPingMonitor();

  // イベントリスナーをクリーンアップ
  if (state.websocket) {
    state.websocket.removeEventListener('open', handleWebSocketOpen);
    state.websocket.removeEventListener('message', handleWebSocketMessage);
    state.websocket.removeEventListener('close', handleWebSocketClosed);
    state.websocket.removeEventListener('error', handleWebSocketError);
  }
  state.websocket = null;

  // 再接続が無効な場合は切断状態のままにする
  if (!state.websocketShouldReconnect) {
    state.websocketStatus = 'disconnected';
    return;
  }

  // 再接続が有効な場合は、ポーリングにフォールバックして再接続をスケジュール
  state.websocketStatus = 'disconnected';
  startPolling({ immediate: false });
  scheduleWebSocketReconnect();
}

/**
 * WebSocketエラーが発生した際のハンドラー
 *
 * エラー発生時に呼ばれ、接続を強制的に閉じます。
 * 閉じることでhandleWebSocketClosedが呼ばれ、自動的に再接続処理が行われます。
 *
 * @param {Event} event - エラーイベント
 */
function handleWebSocketError(event) {
  console.warn('WebSocket encountered an error:', event);

  // エラー発生時は接続を閉じる（handleWebSocketClosedで再接続処理が行われる）
  try {
    state.websocket?.close();
  } catch (error) {
    console.warn('Failed to close WebSocket after error:', error);
  }
}

/**
 * WebSocketメッセージ受信時のハンドラー
 *
 * サーバーから送信されたメッセージを受信し、内容に応じて処理を振り分けます。
 * - ping: 接続維持用のメッセージ（タイムスタンプのみ更新）
 * - status: AI応答生成のステータス更新（started, generating, completed, canceledなど）
 * - tool_update: ツール実行結果のリアルタイム更新
 *
 * @param {MessageEvent} event - メッセージイベント
 */
function handleWebSocketMessage(event) {
  // ping受信時刻を更新（接続監視用）
  state.lastPingReceivedAt = Date.now();

  // メッセージをJSONとしてパース
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch (error) {
    console.warn('Failed to parse WebSocket payload:', error);
    return;
  }

  // payloadが無効な場合は処理しない
  if (!payload || typeof payload !== 'object') {
    return;
  }

  // pingメッセージの場合は何もしない（タイムスタンプ更新のみで十分）
  if (payload.ping) {
    return;
  }

  // ステータスブロードキャスト（AI応答生成の進行状況）
  if (typeof payload.status === 'string') {
    handleStatusBroadcast(payload);
  }
}

/**
 * AI応答生成のステータス更新を処理
 *
 * WebSocketで受信したAI応答生成のステータス（started, generating, completed, canceled）に応じて、
 * 画面表示を更新します。生成中は進行状況をリアルタイムで表示し、
 * 完了時にはサーバーから最新のメッセージを再取得して確定した内容を表示します。
 *
 * @param {Object} payload - ステータスペイロード
 * @param {string} payload.status - ステータス（started, generating, completed, canceled）
 * @param {string} payload.response - 生成中のAI応答テキスト
 */
function handleStatusBroadcast(payload) {
  // ステータスとレスポンステキストを正規化
  const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : '';
  const response = typeof payload.response === 'string' ? payload.response : '';

  // ステータスが空の場合は処理しない
  if (!status) {
    return;
  }

  // ライブ生成状態を更新または作成
  if (!state.liveGeneration) {
    state.liveGeneration = {
      status,
      text: response,
      timestamp: Date.now()
    };
  } else {
    state.liveGeneration.status = status;
    state.liveGeneration.text = response;
    state.liveGeneration.timestamp = Date.now();
  }

  // 送信ボタンの表示を更新（生成中はキャンセルボタンに切り替え）
  refreshSendButton();

  // ステータスに応じた処理
  switch (status) {
    case 'started':
      // 生成開始時は空のメッセージを表示（プレースホルダー）
      state.liveGeneration.text = '';
      renderLiveGenerationMessage();
      scrollToBottom({ deferOnly: true });
      break;

    case 'generating':
      // 生成中は受信したテキストをリアルタイムで表示
      renderLiveGenerationMessage();
      scrollToBottom({ deferOnly: true });
      break;

    case 'completed':
      // 生成完了時は最終的な表示をしてから、サーバーから確定したメッセージを再取得
      renderLiveGenerationMessage();
      reloadMessages({ forceScroll: true })
        .catch(error => console.error('Failed to refresh messages after completion:', error))
        .finally(() => {
          // メッセージ再読み込み後、ライブ生成状態をクリア
          if (state.liveGeneration && state.liveGeneration.status === 'completed') {
            state.liveGeneration = null;
            renderLiveGenerationMessage();
            refreshSendButton();
          }
        });
      break;

    case 'canceled':
      // キャンセル時は一時的にキャンセルメッセージを表示してから状態をクリア
      renderLiveGenerationMessage();
      setTimeout(() => {
        if (state.liveGeneration && state.liveGeneration.status === 'canceled') {
          state.liveGeneration = null;
          renderLiveGenerationMessage();
          refreshSendButton();
        }
      }, 2500);
      break;

    case 'tool_update':
      renderLiveGenerationMessage();
      reloadMessages({ forceScroll: true })
        .catch(error => console.error('Failed to refresh messages after completion:', error));
      break;

    default:
      // その他のステータスの場合は単純に再描画
      renderLiveGenerationMessage();
      break;
  }
}

/**
 * WebSocket再接続をスケジュール
 *
 * 接続失敗時や切断時に呼び出され、指数バックオフアルゴリズムで再接続を試みます。
 * 試行回数が増えるほど待機時間が長くなり、サーバーへの負荷を軽減します。
 */
function scheduleWebSocketReconnect() {
  // 再接続が無効化されている場合は何もしない
  if (!state.websocketShouldReconnect) {
    return;
  }

  // 再接続試行回数をインクリメント
  state.websocketReconnectAttempts += 1;

  // 試行回数に応じて待機時間を計算（指数バックオフ、最大5回まで）
  const attempt = Math.min(state.websocketReconnectAttempts, 5);
  const delay = Math.min(WS_RECONNECT_BASE_DELAY_MS * attempt, WS_RECONNECT_MAX_DELAY_MS);

  // 指定した遅延時間後に再接続を試行
  state.websocketReconnectTimer = setTimeout(() => {
    connectWebSocket();
  }, delay);
}

/**
 * WebSocket再接続タイマーをクリア
 *
 * 再接続が成功した際や、手動で接続を切断する際に呼び出され、
 * スケジュール済みの再接続処理をキャンセルします。
 */
function clearWebSocketReconnectTimer() {
  // 再接続タイマーが設定されている場合はクリア
  if (state.websocketReconnectTimer) {
    clearTimeout(state.websocketReconnectTimer);
    state.websocketReconnectTimer = null;
  }
}

/**
 * Ping監視を開始
 *
 * WebSocket接続が確立された後に呼び出され、サーバーからのpingメッセージを定期的に監視します。
 * 一定時間pingが届かない場合は接続が切れているとみなし、再接続処理を開始します。
 */
function startPingMonitor() {
  // 既存の監視タイマーがあれば停止
  stopPingMonitor();

  // 定期的にping受信状況をチェック
  state.pingMonitorHandle = setInterval(() => {
    // WebSocketが接続状態でない場合は監視を停止
    if (state.websocketStatus !== 'connected') {
      stopPingMonitor();
      return;
    }

    // 最後のping受信からタイムアウト時間を超えている場合は接続を閉じる
    if (Date.now() - state.lastPingReceivedAt > WS_PING_TIMEOUT_MS) {
      console.warn('WebSocket ping timeout detected. Closing connection.');
      try {
        // 接続を閉じることでhandleWebSocketClosedが呼ばれ、再接続処理が開始される
        state.websocket?.close();
      } catch (error) {
        console.warn('Failed to close WebSocket after ping timeout:', error);
      }
    }
  }, WS_PING_CHECK_INTERVAL_MS);
}

/**
 * Ping監視を停止
 *
 * WebSocket接続が切断された際や、手動で接続を終了する際に呼び出されます。
 */
function stopPingMonitor() {
  // ping監視が開始されていない場合は何もしない
  if (!state.pingMonitorHandle) {
    return;
  }
  clearInterval(state.pingMonitorHandle);
  state.pingMonitorHandle = null;
}

/**
 * リアルタイム通信をシャットダウン
 *
 * WebSocket接続とポーリングを完全に停止します。
 * ページ離脱時や、意図的に通信を終了する際に呼び出されます。
 */
function shutdownRealtime() {
  // 再接続を無効化
  state.websocketShouldReconnect = false;

  // ping監視を停止
  stopPingMonitor();

  // 再接続タイマーをクリア
  clearWebSocketReconnectTimer();

  // WebSocket接続を閉じる
  if (state.websocket) {
    try {
      state.websocket.close();
    } catch (error) {
      console.warn('Failed to close WebSocket during shutdown:', error);
    }
  }

  // ポーリングを停止
  stopPolling();
}

/**
 * ペルソナ情報とメッセージを同時に再読み込み
 *
 * ペルソナのサマリー情報、メディアファイル、メッセージ履歴を
 * すべて再取得して画面を更新します。
 * ペルソナ切り替え後やリフレッシュ操作時に使用します。
 */
async function reloadAll() {
  await loadPersonaSummary();
  await loadPersonaMedia();
  await reloadMessages({ forceScroll: true });
}

/**
 * タブの表示状態変更を処理
 *
 * タブがアクティブになった際に呼び出され、バックグラウンド中に
 * 更新されたメッセージを取得します。また、WebSocket接続が切れている場合は再接続を試みます。
 */
async function handleVisibilityChange() {
  // タブが非表示になった場合は何もしない
  if (document.visibilityState !== 'visible') {
    return;
  }

  // ポーリングを即座に開始してメッセージを取得
  startPolling({ immediate: true });

  // WebSocket再接続が有効な場合は接続状態を確認
  if (state.websocketShouldReconnect) {
    ensureWebSocketConnected();
  }

  // メッセージを再読み込み
  try {
    await reloadMessages();
  } catch (error) {
    console.error('Failed to refresh messages after tab became visible:', error);
  }
}

// ページ離脱時にペルソナメディアをクリーンアップ（メモリリーク防止）
// blob URLを解放しないとメモリリークの原因になる
window.addEventListener('beforeunload', () => {
  cleanupPersonaMedia();
  shutdownRealtime();
});

// カラースキーム変更（ダーク/ライトモード切り替え）の監視
// テーマが変更された際に背景画像のオーバーレイ色を再適用
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const colorSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)');

  // カラースキーム変更時のハンドラー
  const handleColorSchemeChange = () => {
    // 背景画像が設定されている場合は再適用（オーバーレイ色をCSSテーマに合わせて更新）
    if (state.personaMedia.background) {
      applyBackgroundImage(state.personaMedia.background);
    }
  };

  // イベントリスナーを登録（ブラウザの対応状況に応じて方法を切り替え）
  if (typeof colorSchemeMedia.addEventListener === 'function') {
    // モダンブラウザ向け（推奨）
    colorSchemeMedia.addEventListener('change', handleColorSchemeChange);
  } else if (typeof colorSchemeMedia.addListener === 'function') {
    // 古いブラウザ向け（非推奨だが互換性のため残している）
    colorSchemeMedia.addListener(handleColorSchemeChange);
  }
}

// ページ読み込み時に初期化を実行
// DOMが完全に構築された後に初期化関数を呼び出す
document.addEventListener('visibilitychange', handleVisibilityChange);
document.addEventListener('DOMContentLoaded', init);
