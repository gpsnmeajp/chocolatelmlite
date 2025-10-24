/**
 * システム設定画面のJavaScript
 *
 * このファイルは、LLMエンドポイント、APIキー、モデル設定、タイムアウト、
 * 各種機能の有効化フラグなど、アプリケーション全体の設定を管理します。
 */

'use strict';

// 主要設定項目のキーリスト（画面上部の基本設定セクションに表示される）
const PRIMARY_FIELD_KEYS = [
  'LlmEndpointUrl',
  'LlmApiKey',
  'DefaultModel',
  'YourName',
  'BreakReminderThreshold',
  'TalkHistoryCutoffThreshold',
  'LocalOnly'
];

// APIキーのマスク表示時のフォールバック文字列
const MASKED_API_KEY_FALLBACK = '************';
const SECRET_FIELD_KEYS = ['LlmApiKey', 'ImageGenerationApiKey'];

// 各設定項目の定義（ラベル、説明文、入力タイプ、バリデーションルール）
const FIELD_DEFINITIONS = {
  LlmEndpointUrl: {
    label: 'Base URL',
    description: 'LLMプロバイダーのOpenAI互換APIのURLを入力します。',
    valueType: 'string',
    inputType: 'url',
    required: true,
    placeholder: 'https://...',
    note: '<a href="https://github.com/gpsnmeajp/chocolatelmlite">詳しくは説明書をご参照ください。</a>',
    order: 1
  },
  LlmApiKey: {
    label: 'APIキー',
    description: 'LLMプロバイダーのAPIキーを入力します。ローカルLLMの場合は空欄可。',
    valueType: 'string',
    inputType: 'password',
    allowEmpty: true,
    placeholder: '************',
    autocomplete: 'off',
    note: '<a href="https://openrouter.ai/settings/keys">OpenRouterの場合はこちらからキーを作成します。</a>',
    order: 2
  },
  DefaultModel: {
    label: '既定の言語モデル',
    description: '特に個別設定しないときに使うモデル名を指定します。(ペルソナ別に個別に指定もできます)',
    valueType: 'string',
    required: true,
    placeholder: 'google/gemini-2.5-flash',
    note: '<a href="https://openrouter.ai/models">OpenRouterの場合はこちらからモデルを探せます</a>',
    order: 3
  },
  YourName: {
    label: 'ユーザーの表示名',
    description: 'チャット画面でユーザーを表す名前です。<br>AIには送信されません。',
    valueType: 'string',
    required: true,
    placeholder: 'あなた',
    order: 4
  },
  BreakReminderThreshold: {
    label: '休憩おしらせ基準値',
    description: '直近8時間にこの数値を超えると、休憩をおすすめする表示が出ます',
    valueType: 'integer',
    min: 0,
    required: true,
    order: 5
  },
  TalkHistoryCutoffThreshold: {
    label: '会話履歴の最大トークン数',
    description: 'この数値を超えた分はAIに送信されなくなります。<br>小さすぎると会話をすぐ忘れられるようになります。<br>大きくするほど処理に時間がかかり、また課金額が上がりやすくなります。',
    valueType: 'integer',
    min: 0,
    required: true,
    order: 6,
    note: ''
  },
  LocalOnly: {
    label: 'ローカルアクセスのみ許可',
    description: '本アプリへの接続を、ローカルからの接続のみに制限します。<br>スマートフォン等LAN内からアクセスできるようにするにはオフにしてください。変更後は再起動が必要です',
    valueType: 'boolean',
    controlLabel: 'このPCのみ許可',
    order: 7,
    note: '。'
  },
  TimeoutSeconds: {
    label: 'タイムアウト秒数',
    description: 'LLM処理のタイムアウト秒数です。ローカルLLMなどでは長めに取る必要があります。',
    valueType: 'integer',
    min: 1,
    required: true,
    order: 100
  },
  Temperature: {
    label: 'Temperature',
    description: '応答の多様性を調整するパラメーターです。(0.0～2.0)',
    valueType: 'number',
    min: 0,
    max: 2,
    step: 0.1,
    required: true,
    order: 101
  },
  MaxTokens: {
    label: '最大トークン数',
    description: '生成時に許可する最大トークン数です。',
    valueType: 'integer',
    min: 1,
    required: true,
    order: 102
  },
  PhotoCutoff: {
    label: '画像履歴の保持上限',
    description: '会話の中で何件前のメッセージまで画像を送信するかの設定です。<br>トークン数(課金額)節約のため古い画像はAIに送信されなくなります。',
    valueType: 'integer',
    min: 0,
    required: true,
    order: 103,
    note: ''
  },
  TimeZone: {
    label: 'タイムゾーン',
    description: 'システムが日付・時刻を扱う際に使用するタイムゾーンIDです。空欄の場合はサーバー既定を使用します。',
    valueType: 'string',
    allowEmpty: true,
    placeholder: 'Asia/Tokyo など',
    order: 104
  },
  HttpPort: {
    label: 'HTTPポート',
    description: 'Webサーバーが待ち受けるポート番号です。変更後は再起動が必要です。',
    valueType: 'integer',
    min: 1,
    max: 65535,
    required: true,
    order: 105
  },
  SystemSettingsLocalOnly: {
    label: 'システム設定変更をローカル限定にする',
    description: 'システム設定ページへのアクセスをこのPCからに限定します。<br>LAN経由で設定を変更させたい場合のみオフにしてください。変更後は再起動が必要です。',
    valueType: 'boolean',
    controlLabel: 'このPCのみ許可',
    order: 106,
    note: ''
  },
  EnableHowto: {
    label: 'Howto機能を有効化',
    description: 'AIが本アプリケーションの概要を理解できるようになります。',
    valueType: 'boolean',
    order: 200
  },
  EnableMemory: {
    label: 'メモリ機能を有効化',
    description: 'AIが大切な情報を覚えておくことができるようになります。',
    valueType: 'boolean',
    order: 201
  },
  EnableJavascript: {
    label: 'JavaScriptサンドボックスを有効化',
    description: 'AIがJavaScriptを実行して計算などができるようになります。(外部通信などはできません)',
    valueType: 'boolean',
    order: 202
  },
  EnableProject: {
    label: 'プロジェクト機能を有効化',
    description: 'AIがprojectフォルダ内を読み書きできるようになります。',
    valueType: 'boolean',
    order: 203  
  },
  EnableTimestamps: {
    label: 'ユーザーの発言にタイムスタンプを付与',
    description: 'AIが発言の日時を認識できるようになります。',
    valueType: 'boolean',
    order: 204
  },
  EnableCurrentTime: {
    label: '現在時刻挿入を有効化',
    description: 'AIが現在の日時情報を取得できるようになります。',
    valueType: 'boolean',
    order: 205
  },
  EnableStatisticsAndBreakReminder: {
    label: '統計と休憩リマインダーを有効化',
    description: 'AIがどれだけ頻繁に会話しているかや、休憩の必要性を認識できるようになります。',
    valueType: 'boolean',
    order: 206
  },
  EnableWebhook: {
    label: 'Webhook通知を有効化',
    description: '外部WebhookへのAI発言の送信を許可します。',
    valueType: 'boolean',
    order: 207
  },
  EnableAutoUpdateCheck: {
    label: '自動アップデートチェック',
    description: '起動時に更新を自動確認します。',
    valueType: 'boolean',
    order: 208
  },
  EnableConsoleMonitor: {
    label: 'コンソールモニターを有効化',
    description: 'コンソールに固定で状態を表示します。ログを見たい場合はオフにします。',
    valueType: 'boolean',
    order: 209
  },
  EnableTimerGenerate: {
    label: '自発的発言タイマーを有効化',
    description: 'AIが自発的に発言できるように定期的に呼び出すタイマー生成機能を使用します。',
    valueType: 'boolean',
    order: 210
  },
  TimerGenerateMessage: {
    label: '自発的発言タイマーメッセージ',
    description: 'タイマー発動時にシステムメッセージとして挿入される文言です。AIが発話の意図を理解しやすい内容にしてください。',
    valueType: 'string',
    required: true,
    placeholder: 'タイマーイベント: ...',
    trim: false,
    order: 211
  },
  TimerGenerateLimitMax: {
    label: '自発的発言タイマー生成上限',
    description: 'AIが自発的な発言を連続で何回まで行えるかの上限です。多いほど長くなりますが、課金がかさむ可能性があります。',
    valueType: 'integer',
    min: 0,
    required: true,
    order: 212
  },

  EnableMcpTools: {
    label: 'MCPツール連携を有効化',
    description: 'Model Context Protocol対応ツールを有効化します。<a href="https://cursor.com/ja/docs/context/mcp">Cursor形式のMCPサーバー定義を</a> dataフォルダ内のmcp.jsonに設定します。<br><br><b>警告: すべてのツールは承認なく実行されます</b>',
    valueType: 'boolean',
    order: 213,
    note: ''
  },
  EnableImageGeneration: {
    label: '画像生成を有効化',
    description: '画像生成LLMプロバイダーを使用して画像を生成します。利用には対応したエンドポイントとAPIキーが必要です。',
    valueType: 'boolean',
    order: 220
  },
  ImageGenerationEndpointUrl: {
    label: '画像生成LLM Base URL',
    description: '画像生成対応LLMプロバイダーのOpenAI互換APIのURLを入力します。',
    valueType: 'string',
    inputType: 'url',
    allowEmpty: true,
    placeholder: 'https://...',
    note: '現在OpenRouterのみ対応しています。<a href="https://github.com/gpsnmeajp/chocolatelmlite">詳しくは説明書をご参照ください。</a>',
    order: 221
  },
  ImageGenerationApiKey: {
    label: '画像生成APIキー',
    description: '画像生成LLMプロバイダーを利用するためのAPIキーです。',
    valueType: 'string',
    inputType: 'password',
    allowEmpty: true,
    autocomplete: 'off',
    placeholder: MASKED_API_KEY_FALLBACK,
    note: '<a href="https://openrouter.ai/settings/keys">OpenRouterの場合はこちらからキーを作成します。</a>',
    order: 222
  },
  ImageGenerationModel: {
    label: '画像生成モデル',
    description: '画像生成に使用するモデル名を指定します。',
    valueType: 'string',
    allowEmpty: true,
    placeholder: 'google/gemini-2.5-flash-image など',
    note: '<a href="https://openrouter.ai/models?fmt=cards&output_modalities=image">OpenRouterの場合はこちらからモデルを探せます</a>',
    order: 223
  },
  DebugMode: {
    label: 'デバッグモード',
    description: '追加のログ出力などデバッグ向け機能を有効にします。性能が落ちることがあります。通常はオフのままにしてください。',
    valueType: 'boolean',
    order: 999
  }
};

// 動的に生成されたフィールド定義を保持するオブジェクト（サーバーから未定義の設定が返された場合に使用）
const dynamicFieldDefinitions = {};
// 最初に読み込んだ設定値を保持（変更検知用）
let originalSettings = {};
// マスクされたAPIキーの値を保持（変更されていない場合はサーバーに送信しない）
let maskedSecretValues = {};

// ページ読み込み時に初期化を実行
document.addEventListener('DOMContentLoaded', init);

/**
 * 初期化関数
 * ページ読み込み時に設定を読み込み、UIをセットアップする
 */
async function init() {
  configureAdvancedSummary();
  setupFormListeners();
  await loadSettings();
}

/**
 * 応用設定セクションの開閉アイコンを制御
 * details要素の開閉状態に応じてラベルの矢印アイコンを変更する
 */
function configureAdvancedSummary() {
  const details = document.getElementById('advancedSettingsContainer');
  const summary = document.getElementById('advancedSettingsSummary');
  if (!details || !summary) {
    return;
  }

  // 開閉状態に応じてラベルを更新する関数
  const updateLabel = () => {
    summary.textContent = details.open ? '▼ 応用的な設定' : '▶ 応用的な設定';
  };

  // details要素の開閉イベントをリスン
  details.addEventListener('toggle', updateLabel);
  // 初期表示時のラベルを設定
  updateLabel();
}

/**
 * フォームのイベントリスナーを設定
 * 送信イベントと入力イベントをハンドリング
 */
function setupFormListeners() {
  const form = document.getElementById('settingsForm');
  if (!form) {
    return;
  }

  // フォーム送信時のハンドラー
  form.addEventListener('submit', handleFormSubmit);
  // 入力フィールドが変更されたら保存ステータスをクリア
  form.addEventListener('input', () => setSaveStatus('', 'idle'));
}

/**
 * サーバーから設定を読み込み、フォームに反映
 * 設定取得後、ローディング状態を解除してフォームを表示する
 */
async function loadSettings() {
  const loading = document.getElementById('loadingState');
  const form = document.getElementById('settingsForm');

  try {
    // サーバーから設定データを取得
    const response = await fetchJson('/api/setting');
    const settings = response && typeof response.settings === 'object' ? response.settings : null;
    if (!settings) {
      throw new Error('サーバーが設定データを返しませんでした。');
    }

    // APIキーがマスクされた状態で返ってくるため、その値を保持
    initializeSecretFieldMasks(settings);

    // 設定項目をセクションごとに描画
    renderSettingsSections(settings);
    // 変更検知用に元の設定値を保存
    storeOriginalSettings(settings);

    // ローディング表示を非表示にしてフォームを表示
    if (loading) {
      loading.hidden = true;
    }
    if (form) {
      form.hidden = false;
    }
    setSaveStatus('', 'idle');
  } catch (error) {
    console.error('Failed to load system settings:', error);
    if (loading) {
      loading.textContent = '設定の読み込みに失敗しました。ページを再読み込みしてください。';
    }
    showAlertModal('システム設定の取得に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
  }
}

function initializeSecretFieldMasks(settings) {
  maskedSecretValues = {};
  SECRET_FIELD_KEYS.forEach((key) => {
    if (!settings || typeof settings[key] !== 'string') {
      maskedSecretValues[key] = '';
      return;
    }
    const raw = settings[key];
    maskedSecretValues[key] = raw && raw.length ? raw : '';
  });
}

/**
 * 設定項目を基本設定と応用設定のセクションに分けて描画
 * @param {Object} settings - サーバーから取得した設定オブジェクト
 */
function renderSettingsSections(settings) {
  const primaryContainer = document.getElementById('primarySettings');
  const advancedContainer = document.getElementById('advancedSettings');
  const advancedDetails = document.getElementById('advancedSettingsContainer');
  const advancedSummary = document.getElementById('advancedSettingsSummary');

  if (!primaryContainer || !advancedContainer || !advancedDetails) {
    return;
  }

  // コンテナをクリア
  primaryContainer.innerHTML = '';
  advancedContainer.innerHTML = '';

  // 基本設定セクションを構築（PRIMARY_FIELD_KEYSに指定された項目）
  const primaryFragment = document.createDocumentFragment();
  PRIMARY_FIELD_KEYS.forEach((key) => {
    const value = settings ? settings[key] : undefined;
    const definition = getFieldDefinition(key, value);
    const item = createSettingItem(key, definition, value);
    if (item) {
      primaryFragment.appendChild(item);
    }
  });
  primaryContainer.appendChild(primaryFragment);

  // 応用設定セクションを構築（PRIMARY_FIELD_KEYS以外の項目）
  const knownAdvancedKeys = Object.keys(FIELD_DEFINITIONS).filter((key) => !PRIMARY_FIELD_KEYS.includes(key));
  const dynamicAdvancedKeys = settings
    ? Object.keys(settings).filter((key) => !PRIMARY_FIELD_KEYS.includes(key) && !FIELD_DEFINITIONS[key])
    : [];
  const advancedKeys = Array.from(new Set([...knownAdvancedKeys, ...dynamicAdvancedKeys]));
  const advancedFragment = document.createDocumentFragment();
  advancedKeys
    .map((key) => {
      const value = settings ? settings[key] : undefined;
      const definition = getFieldDefinition(key, value);
      return {
        key,
        value,
        definition,
        order: definition?.order ?? 1000 // orderプロパティで表示順序を制御
      };
    })
    .filter(({ definition }) => Boolean(definition))
    .sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.key.localeCompare(b.key);
    })
    .forEach(({ key, definition, value }) => {
      const item = createSettingItem(key, definition, value);
      if (item) {
        advancedFragment.appendChild(item);
      }
    });

  // 応用設定が存在する場合のみセクションを表示
  if (advancedFragment.childNodes.length) {
    advancedContainer.appendChild(advancedFragment);
    advancedDetails.hidden = false;
    advancedDetails.open = false;
    advancedDetails.removeAttribute('open');
    if (advancedSummary) {
      advancedSummary.textContent = '▶ 応用的な設定';
    }
  } else {
    advancedDetails.hidden = true;
  }
}

/**
 * 設定項目のDOM要素を生成
 * @param {string} key - 設定キー
 * @param {Object} definition - フィールド定義
 * @param {*} value - 現在の設定値
 * @returns {HTMLElement|null} - 設定項目のDOM要素
 */
function createSettingItem(key, definition, value) {
  if (!definition) {
    return null;
  }

  // 設定項目全体のラッパー
  const wrapper = document.createElement('div');
  wrapper.className = 'setting-item';

  // ラベルと説明文を含むテキストコンテナ
  const textContainer = document.createElement('div');
  textContainer.className = 'setting-text';

  const controlId = `setting-${key}`;
  const label = document.createElement('label');
  label.className = 'setting-label';
  label.setAttribute('for', controlId);
  label.textContent = definition.label || key;

  const description = document.createElement('p');
  description.className = 'setting-description';
  description.innerHTML = definition.description || 'この設定の説明は未設定です。';

  textContainer.appendChild(label);
  textContainer.appendChild(description);

  // 入力コントロール（テキストボックス、チェックボックスなど）を構築
  const controlWrapper = buildControlElement(key, definition, value, controlId);
  if (!controlWrapper) {
    return null;
  }

  wrapper.appendChild(textContainer);
  wrapper.appendChild(controlWrapper);
  return wrapper;
}

/**
 * 設定項目の入力コントロール要素を構築
 * @param {string} key - 設定キー
 * @param {Object} definition - フィールド定義
 * @param {*} value - 現在の設定値
 * @param {string} controlId - コントロールのID属性値
 * @returns {HTMLElement|null} - コントロール要素
 */
function buildControlElement(key, definition, value, controlId) {
  const container = document.createElement('div');
  container.className = 'setting-control';

  // boolean型の場合はチェックボックスを生成
  if (definition.valueType === 'boolean') {
    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'toggle-label';
    checkboxLabel.setAttribute('for', controlId);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = controlId;
    checkbox.dataset.settingKey = key;
    checkbox.checked = normalizeBoolean(value);

    checkboxLabel.appendChild(checkbox);

    const textSpan = document.createElement('span');
    textSpan.textContent = definition.controlLabel || '有効にする';
    checkboxLabel.appendChild(textSpan);

    container.appendChild(checkboxLabel);
    return container;
  }

  // テキストボックス、数値入力などのinput要素を生成
  const input = document.createElement('input');
  input.id = controlId;
  input.dataset.settingKey = key;
  input.autocomplete = definition.autocomplete || 'off';

  // inputTypeが定義されている場合はそれを使用、それ以外は値の型に基づいて決定
  if (definition.inputType) {
    input.type = definition.inputType;
  } else if (definition.valueType === 'integer' || definition.valueType === 'number') {
    input.type = 'number';
  } else {
    input.type = 'text';
  }

  // プレースホルダーを設定
  if (definition.placeholder) {
    input.placeholder = definition.placeholder;
  }

  // 数値型の場合は最小値、最大値、ステップ値を設定
  if (definition.valueType === 'integer' || definition.valueType === 'number') {
    if (definition.min !== undefined) {
      input.min = String(definition.min);
    }
    if (definition.max !== undefined) {
      input.max = String(definition.max);
    }
    if (definition.step !== undefined) {
      input.step = String(definition.step);
    } else if (definition.valueType === 'number') {
      input.step = '0.1';
    } else {
      input.step = '1';
    }
  }

  // 値をフォーマットしてinputにセット
  input.value = formatValueForInput(definition, value, key);

  container.appendChild(input);

  // 補足説明（note）がある場合は追加
  if (definition.note) {
    container.classList.add('has-note');
    const note = document.createElement('p');
    note.className = 'setting-note';
    note.innerHTML = definition.note;
    container.appendChild(note);
  }

  return container;
}

/**
 * フォーム送信ハンドラー
 * バリデーション、変更検知、サーバーへの送信を行う
 * @param {Event} event - submitイベント
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const saveButton = document.getElementById('saveButton');
  if (saveButton) {
    saveButton.disabled = true;
  }

  setSaveStatus('保存しています...', 'idle');

  try {
    // フォームの全入力値を収集してバリデーション
    const { values, errors } = collectFormValues();
    if (errors.length) {
      throw new Error(errors[0]);
    }

    // 変更された項目のみを含むペイロードを構築
    const payload = buildPayload(values);
    if (!Object.keys(payload).length) {
      setSaveStatus('変更はありません。', 'idle');
      return;
    }

    // サーバーに設定を送信
    const result = await fetchJson('/api/setting', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (result && result.error) {
      throw new Error(result.error);
    }

    // 保存成功後、元の設定値を更新
    applySavedValues(payload);
    setSaveStatus('保存しました。', 'success');
  } catch (error) {
    console.error('Failed to save system settings:', error);
    setSaveStatus(error.message || '保存に失敗しました。', 'error');
  } finally {
    // ボタンを再度有効化
    if (saveButton) {
      saveButton.disabled = false;
    }
  }
}

/**
 * フォームの全入力値を収集してバリデーション
 * @returns {{ values: Object, errors: Array<string> }} - 収集した値とエラーメッセージの配列
 */
function collectFormValues() {
  const elements = document.querySelectorAll('[data-setting-key]');
  const values = {};
  const errors = [];

  elements.forEach((element) => {
    if (!(element instanceof HTMLInputElement)) {
      return;
    }
    const key = element.dataset.settingKey;
    if (!key) {
      return;
    }

    const definition = getFieldDefinition(key);
    if (!definition) {
      return;
    }

    // boolean型の場合はチェック状態を取得
    if (definition.valueType === 'boolean') {
      values[key] = element.checked;
      return;
    }

    // 数値型の場合はパースとバリデーションを実施
    if (definition.valueType === 'integer' || definition.valueType === 'number') {
      const raw = element.value.trim();
      // 空欄チェック
      if (!raw && !definition.allowEmpty) {
        errors.push(`${definition.label || key}を入力してください。`);
        return;
      }

      // 空欄が許可されている場合
      if (!raw && definition.allowEmpty) {
        values[key] = '';
        return;
      }

      // 整数または浮動小数点数としてパース
      const parsed = definition.valueType === 'integer'
        ? Number.parseInt(raw, 10)
        : Number.parseFloat(raw);

      // 数値として有効かチェック
      if (!Number.isFinite(parsed)) {
        errors.push(`${definition.label || key}は数値で入力してください。`);
        return;
      }

      // 最小値チェック
      if (definition.min !== undefined && parsed < definition.min) {
        errors.push(`${definition.label || key}は${definition.min}以上を指定してください。`);
        return;
      }

      // 最大値チェック
      if (definition.max !== undefined && parsed > definition.max) {
        errors.push(`${definition.label || key}は${definition.max}以下を指定してください。`);
        return;
      }

      values[key] = parsed;
      return;
    }

    // 文字列型の場合
    const rawValue = definition.trim === false ? element.value : element.value.trim();
    if (!rawValue && definition.required && !definition.allowEmpty) {
      errors.push(`${definition.label || key}を入力してください。`);
      return;
    }

    values[key] = rawValue;
  });

  return { values, errors };
}

/**
 * 変更された設定項目のみを含むペイロードを構築
 * APIキーは特別扱い（マスク値と同じ場合は送信しない）
 * @param {Object} values - 収集した全入力値
 * @returns {Object} - 変更された項目のみを含むペイロード
 */
function buildPayload(values) {
  const payload = {};
  Object.entries(values).forEach(([key, value]) => {
    // APIキーは特別処理（マスク値と同じなら変更なしとみなす）
    if (SECRET_FIELD_KEYS.includes(key)) {
      const masked = typeof maskedSecretValues[key] === 'string' ? maskedSecretValues[key] : MASKED_API_KEY_FALLBACK;
      if (typeof value === 'string' && value === masked) {
        return;
      }
      payload[key] = value;
      return;
    }

    // その他の項目は元の値と比較
    const newValue = normalizeForComparison(key, value);
    const previousValue = originalSettings[key];
    if (!areValuesEqual(newValue, previousValue)) {
      payload[key] = value;
    }
  });
  return payload;
}

/**
 * 保存された値を元の設定値として更新
 * APIキーは再度マスク表示に戻す
 * @param {Object} payload - 保存したペイロード
 */
function applySavedValues(payload) {
  Object.entries(payload).forEach(([key, value]) => {
    // APIキーの場合はマスク表示に戻す
    if (SECRET_FIELD_KEYS.includes(key)) {
      const input = document.querySelector(`[data-setting-key="${key}"]`);
      if (input instanceof HTMLInputElement) {
        if (typeof value === 'string' && value.length) {
          // 新しいキーが保存されたので、マスク値を表示
          maskedSecretValues[key] = MASKED_API_KEY_FALLBACK;
          input.value = MASKED_API_KEY_FALLBACK;
          originalSettings[key] = '__HAS_VALUE__';
        } else {
          // キーが削除された
          maskedSecretValues[key] = '';
          input.value = '';
          originalSettings[key] = '__EMPTY__';
        }
      }
      return;
    }

    // その他の項目は正規化した値を保存
    originalSettings[key] = normalizeForComparison(key, value);
  });
}

/**
 * 最初に読み込んだ設定値を変更検知用に保存
 * APIキーはマスク状態を保持
 * @param {Object} settings - サーバーから取得した設定オブジェクト
 */
function storeOriginalSettings(settings) {
  originalSettings = {};
  Object.entries(settings).forEach(([key, value]) => {
    if (SECRET_FIELD_KEYS.includes(key)) {
      const hasValue = typeof value === 'string' && value.length > 0;
      originalSettings[key] = hasValue ? '__HAS_VALUE__' : '__EMPTY__';
      maskedSecretValues[key] = hasValue ? MASKED_API_KEY_FALLBACK : '';
      return;
    }
    originalSettings[key] = normalizeForComparison(key, value);
  });

  SECRET_FIELD_KEYS.forEach((key) => {
    if (!(key in originalSettings)) {
      originalSettings[key] = '__EMPTY__';
      maskedSecretValues[key] = '';
    }
  });
}

/**
 * 値を比較可能な形式に正規化
 * 型変換やトリムを行い、比較に適した形式に統一する
 * @param {string} key - 設定キー
 * @param {*} value - 正規化する値
 * @returns {*} - 正規化された値
 */
function normalizeForComparison(key, value) {
  // APIキーは特別扱い（値の有無のみを記録）
  if (SECRET_FIELD_KEYS.includes(key)) {
    if (typeof value === 'string' && value.length) {
      return '__HAS_VALUE__';
    }
    return '__EMPTY__';
  }

  const definition = getFieldDefinition(key);
  if (!definition) {
    return value;
  }

  // boolean型は真偽値に統一
  if (definition.valueType === 'boolean') {
    return normalizeBoolean(value);
  }

  // 整数型はパースして数値化
  if (definition.valueType === 'integer') {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // 浮動小数点型はパースして数値化
  if (definition.valueType === 'number') {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // 文字列型はトリム（定義でtrim=falseの場合は除く）
  if (typeof value === 'string') {
    return definition.trim === false ? value : value.trim();
  }

  return value ?? '';
}

/**
 * 2つの値が等しいかどうかを判定
 * 浮動小数点数の場合は誤差を考慮して比較
 * @param {*} nextValue - 新しい値
 * @param {*} previousValue - 以前の値
 * @returns {boolean} - 等しい場合はtrue
 */
function areValuesEqual(nextValue, previousValue) {
  // 浮動小数点数の場合は誤差を許容して比較
  if (typeof nextValue === 'number' && typeof previousValue === 'number') {
    return Math.abs(nextValue - previousValue) < 1e-9;
  }
  return nextValue === previousValue;
}

/**
 * 様々な型の値をboolean型に正規化
 * @param {*} value - 変換する値
 * @returns {boolean} - 正規化されたboolean値
 */
function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  // 文字列の場合は "true" または "1" をtrueとみなす
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  // 数値の場合は0以外をtrueとみなす
  if (typeof value === 'number') {
    return value !== 0;
  }
  return false;
}

/**
 * 設定値をinput要素に表示するための文字列にフォーマット
 * @param {Object} definition - フィールド定義
 * @param {*} value - フォーマットする値
 * @param {string} key - 設定キー
 * @returns {string} - フォーマットされた文字列
 */
function formatValueForInput(definition, value, key) {
  // APIキーは常にマスク表示
  if (SECRET_FIELD_KEYS.includes(key)) {
    if (typeof value === 'string' && value.length) {
      return value;
    }
    const masked = maskedSecretValues[key];
    if (typeof masked === 'string' && masked.length) {
      return masked;
    }
    return '';
  }

  // boolean型は "on" または空文字列（チェックボックス用）
  if (definition.valueType === 'boolean') {
    return normalizeBoolean(value) ? 'on' : '';
  }

  // 数値型は文字列に変換（無効な値は空文字列）
  if (definition.valueType === 'integer' || definition.valueType === 'number') {
    const parsed = definition.valueType === 'integer'
      ? Number.parseInt(String(value), 10)
      : Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? String(parsed) : '';
  }

  // 文字列型はトリム（定義でtrim=falseの場合は除く）
  if (typeof value === 'string') {
    return definition.trim === false ? value : value.trim();
  }

  // null/undefinedは空文字列
  if (value === undefined || value === null) {
    return '';
  }

  // その他は文字列に変換
  return String(value);
}

/**
 * 設定キーに対応するフィールド定義を取得
 * 事前定義がない場合は、実行時の値から推測した定義を動的に生成
 * @param {string} key - 設定キー
 * @param {*} runtimeValue - 実行時の値（型推測用）
 * @returns {Object} - フィールド定義
 */
function getFieldDefinition(key, runtimeValue) {
  // 事前定義があればそれを返す
  if (FIELD_DEFINITIONS[key]) {
    return FIELD_DEFINITIONS[key];
  }

  // 動的定義がキャッシュされていなければ生成
  if (!dynamicFieldDefinitions[key]) {
    dynamicFieldDefinitions[key] = buildFallbackDefinition(key, runtimeValue);
  }
  return dynamicFieldDefinitions[key];
}

/**
 * フィールド定義が存在しない場合に、実行時の値から定義を推測
 * @param {string} key - 設定キー
 * @param {*} runtimeValue - 実行時の値（型推測用）
 * @returns {Object} - 推測したフィールド定義
 */
function buildFallbackDefinition(key, runtimeValue) {
  const value = runtimeValue;
  // boolean型の場合
  if (typeof value === 'boolean') {
    return {
      label: key,
      description: 'この設定の説明は未設定です。',
      valueType: 'boolean'
    };
  }

  // 数値型の場合（整数か浮動小数点数かを判定）
  if (typeof value === 'number') {
    return {
      label: key,
      description: 'この設定の説明は未設定です。',
      valueType: Number.isInteger(value) ? 'integer' : 'number',
      min: undefined,
      allowEmpty: false
    };
  }

  // それ以外は文字列型として扱う
  return {
    label: key,
    description: 'この設定の説明は未設定です。',
    valueType: 'string',
    allowEmpty: true
  };
}

/**
 * 保存ステータスメッセージを更新
 * @param {string} message - 表示するメッセージ
 * @param {string} status - ステータスタイプ（'success', 'error', 'idle'）
 */
function setSaveStatus(message, status) {
  const statusElement = document.getElementById('saveStatus');
  if (!statusElement) {
    return;
  }

  // メッセージを設定
  statusElement.textContent = message || '';
  // 既存のステータスクラスを削除
  statusElement.classList.remove('success', 'error');

  // ステータスに応じたクラスを追加
  if (status === 'success') {
    statusElement.classList.add('success');
  } else if (status === 'error') {
    statusElement.classList.add('error');
  }
}
