/**
 * ペルソナ管理画面のJavaScript
 *
 * このファイルは、ペルソナの一覧表示、作成、複製、削除、
 * およびアクティブなペルソナの選択を行う機能を提供します。
 */

// ペルソナの一覧を保持する配列
let personas = [];
// 現在アクティブなペルソナのID
let activePersonaId = null;
// ペルソナのアクティブ化中かどうかを示すフラグ
let isActivating = false;

// ページ読み込み時に初期化を実行
document.addEventListener('DOMContentLoaded', init);

/**
 * 初期化関数
 * ページ読み込み時にペルソナ一覧を読み込む
 */
async function init() {
  await loadPersonas();
}

/**
 * ウェルカム画面に遷移
 */
function goToWelcome() {
  window.location.href = 'index.htm';
}

/**
 * サーバーからペルソナ一覧を読み込み、画面に表示
 *
 * ペルソナ一覧とアクティブなペルソナのIDを取得し、
 * テーブルとセレクトボックスに反映します。
 */
async function loadPersonas() {
  try {
    // サーバーからペルソナ一覧を取得
    const data = await fetchJson('/api/persona');

    // データを配列として正規化し、各項目をパース
    personas = Array.isArray(data?.personas) ? data.personas.map(parsePersonaSummary) : [];

    personas.sort((a, b) => {
      const aTime = Number(a.lastUpdated ?? 0);
      const bTime = Number(b.lastUpdated ?? 0);
      if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
        return 0;
      }
      if (Number.isNaN(aTime)) {
        return 1;
      }
      if (Number.isNaN(bTime)) {
        return -1;
      }
      return bTime - aTime;
    });

    // アクティブなペルソナIDを正規化
    activePersonaId = normalizePersonaId(data?.active);

    // 画面に反映
    renderPersonaTable();
    populatePersonaSelects();
  } catch (error) {
    console.error('Failed to load personas:', error);
    showAlertModal('ペルソナ一覧の取得に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
  }
}

/**
 * アクティブ化処理の表示状態を更新
 *
 * ローディングオーバーレイの表示とリストの操作可否を切り替えます。
 *
 * @param {boolean} isLoading - アクティブ化処理中かどうか
 */
function setActivationState(isLoading) {
  isActivating = isLoading;

  const rowsContainer = document.getElementById('personaRows');
  if (rowsContainer) {
    rowsContainer.classList.toggle('is-disabled', isLoading);
    rowsContainer.setAttribute('aria-disabled', String(isLoading));
  }

  const loadingOverlay = document.getElementById('personaLoading');
  if (loadingOverlay) {
    loadingOverlay.classList.toggle('active', isLoading);
    loadingOverlay.setAttribute('aria-hidden', String(!isLoading));
  }
}

/**
 * ペルソナサマリーをパースして統一された形式に変換
 *
 * サーバーから返されるペルソナデータはオブジェクト形式（id, name, timestamp）のため、
 * 統一的に扱えるよう変換します。
 *
 * @param {Object} item - サーバーから取得したペルソナデータ
 * @returns {Object} - { id, name, lastUpdated } の形式に正規化されたオブジェクト
 */
function parsePersonaSummary(item) {
  // タプル形式またはオブジェクト形式からidを取得
  const id = typeof item === 'object' && item !== null ? (item.id ?? 0) : 0;

  // タプル形式またはオブジェクト形式からnameを取得
  const name = typeof item === 'object' && item !== null ? (item.name ?? '') : '';

  // タプル形式またはオブジェクト形式からtimestampを取得
  const timestamp = typeof item === 'object' && item !== null ? (item.timestamp ?? '') : '';

  return {
    id: Number(id),
    name: name,
    lastUpdated: timestamp
  };
}

/**
 * ペルソナ一覧をテーブルとして画面に描画
 *
 * personas配列の内容を元に、各ペルソナの行を生成して表示します。
 * アクティブなペルソナには特別なスタイルが適用されます。
 */
function renderPersonaTable() {
  const container = document.getElementById('personaRows');
  if (!container) {
    return;
  }

  // コンテナをクリア
  container.innerHTML = '';

  // 現在のアクティブ化状態を反映
  container.classList.toggle('is-disabled', isActivating);

  // ペルソナが1つもない場合はメッセージを表示
  if (personas.length === 0) {
    container.innerHTML = '<div class="persona-row"><div>ペルソナがありません</div><div></div><div></div></div>';
    return;
  }

  // DocumentFragmentを使用してパフォーマンスを向上
  const fragment = document.createDocumentFragment();

  personas.forEach(persona => {
    // ペルソナの行を作成
    const row = document.createElement('div');

    // アクティブなペルソナには'active'クラスを追加
    row.className = `persona-row${persona.id === activePersonaId ? ' active' : ''}`;

    // クリックで選択できるようにする
    row.onclick = () => {
      if (!isActivating) {
        selectPersona(persona.id);
      }
    };

    // 行の内容を設定（XSS対策のためescapeHtmlを使用）
    row.innerHTML = `
      <div class="persona-name">${escapeHtml(persona.name || '(名称未設定)')}</div>
      <div class="persona-id">${escapeHtml(formatPersonaId(persona.id))}</div>
      <div class="persona-date">${escapeHtml(formatDateTime(persona.lastUpdated))}</div>
    `;

    fragment.appendChild(row);
  });

  // 一括で追加してレンダリングを最適化
  container.appendChild(fragment);
}

/**
 * モーダルのセレクトボックスにペルソナの選択肢を追加
 *
 * 複製、削除のモーダルで使用するセレクトボックスに、
 * 現在のペルソナ一覧を反映します。
 */
function populatePersonaSelects() {
  // 更新対象のセレクトボックスのIDリスト
  const selects = ['duplicateSource', 'deleteId'];

  selects.forEach(id => {
    const select = document.getElementById(id);
    if (!select) {
      return;
    }

    // 現在選択されている値を保持
    const currentValue = select.value;

    // セレクトボックスをクリアして「選択してください」を追加
    select.innerHTML = '<option value="">選択してください</option>';

    // 各ペルソナをオプションとして追加
    personas.forEach(persona => {
      const option = document.createElement('option');
      option.value = String(persona.id);
      option.textContent = `${persona.name || '(名称未設定)'} (${formatPersonaId(persona.id)})`;
      select.appendChild(option);
    });

    // 以前の選択値が存在する場合は復元
    if (currentValue) {
      select.value = currentValue;
    }
  });
}

/**
 * 指定したペルソナをアクティブにして、トーク画面に遷移
 *
 * @param {number} id - アクティブにするペルソナのID
 */
async function selectPersona(id) {
  if (isActivating) {
    return;
  }

  setActivationState(true);
  let activationSucceeded = false;

  try {
    // サーバーにアクティブなペルソナを設定
    await fetchJson('/api/persona/active', {
      method: 'POST',
      body: JSON.stringify({ id: String(id) })
    });

    activationSucceeded = true;

    // トーク画面に遷移
    window.location.href = 'talk.htm';
  } catch (error) {
    console.error('Failed to activate persona:', error);
    showAlertModal('ペルソナの切り替えに失敗しました。(通信エラー)<br>通信環境を再確認し、リロードしてください。', { title: 'エラー' });
  } finally {
    if (!activationSucceeded) {
      setActivationState(false);
    }
  }
}

/**
 * 新規ペルソナ作成モーダルを表示
 */
function showNewModal() {
  // 入力フィールドをクリア
  const input = document.getElementById('newName');
  if (input) {
    input.value = '';
  }
  openModal('newModal');
}

/**
 * ペルソナ複製モーダルを表示
 */
function showDuplicateModal() {
  // セレクトボックスを最新のペルソナ一覧で更新
  populatePersonaSelects();

  // 入力フィールドをクリア
  const input = document.getElementById('duplicateName');
  if (input) {
    input.value = '';
  }
  openModal('duplicateModal');
}

/**
 * ペルソナ削除モーダルを表示
 */
function showDeleteModal() {
  // セレクトボックスを最新のペルソナ一覧で更新
  populatePersonaSelects();
  openModal('deleteModal');
}

/**
 * モーダルを開く
 *
 * @param {string} id - モーダルの要素ID
 */
function openModal(id) {
  const modal = document.getElementById(id);
  modal?.classList.add('active');
}

/**
 * モーダルを閉じる
 *
 * @param {string} id - モーダルの要素ID
 */
function closeModal(id) {
  const modal = document.getElementById(id);
  modal?.classList.remove('active');
}

/**
 * 新しいペルソナを作成
 *
 * 入力された名前で新しいペルソナをサーバーに作成し、
 * 成功したらモーダルを閉じてペルソナ一覧を再読み込みします。
 */
async function createPersona() {
  // 入力値を取得
  const nameInput = document.getElementById('newName');
  const name = nameInput?.value.trim() ?? '';

  // バリデーション
  if (!name) {
    showAlertModal('表示名を入力してください。', { title: '入力確認' });
    return;
  }

  try {
    // サーバーに新規ペルソナを作成
    await fetchJson('/api/persona/new', {
      method: 'POST',
      body: JSON.stringify({ name })
    });

    // モーダルを閉じて一覧を再読み込み
    closeModal('newModal');
    await loadPersonas();
  } catch (error) {
    console.error('Failed to create persona:', error);
    showAlertModal('ペルソナの作成に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
  }
}

/**
 * ペルソナを複製
 *
 * 選択したペルソナを複製して新しいペルソナを作成します。
 * 新しい名前が指定されている場合はそれを使用し、指定がない場合は元の名前がコピーされます。
 */
async function duplicatePersona() {
  // 入力値を取得
  const sourceSelect = document.getElementById('duplicateSource');
  const nameInput = document.getElementById('duplicateName');
  const sourceId = sourceSelect?.value;
  const newName = nameInput?.value.trim() ?? '';

  // バリデーション
  if (!sourceId) {
    showAlertModal('複製元のペルソナを選択してください。', { title: '入力確認' });
    return;
  }

  try {
    // リクエストペイロードを作成
    const payload = { id: String(sourceId) };

    // 新しい名前が指定されている場合は追加
    if (newName) {
      payload.name = newName;
    }

    // サーバーにペルソナ複製をリクエスト
    await fetchJson('/api/persona/duplicate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // モーダルを閉じて一覧を再読み込み
    closeModal('duplicateModal');
    await loadPersonas();
  } catch (error) {
    console.error('Failed to duplicate persona:', error);
    showAlertModal('ペルソナの複製に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
  }
}

/**
 * ペルソナを削除
 *
 * 選択したペルソナを削除します。
 */
async function deletePersona() {
  // 入力値を取得
  const id = document.getElementById('deleteId')?.value;

  // バリデーション
  if (!id) {
    showAlertModal('削除するペルソナを選択してください。', { title: '入力確認' });
    return;
  }

  try {
    // サーバーにペルソナ削除をリクエスト
    await fetchJson('/api/persona/remove', {
      method: 'POST',
      body: JSON.stringify({ id })
    });

    // モーダルを閉じて一覧を再読み込み
    closeModal('deleteModal');
    await loadPersonas();
  } catch (error) {
    console.error('Failed to delete persona:', error);
    showAlertModal('ペルソナの削除に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
  }
}

/**
 * ペルソナIDを正規化
 *
 * null、undefined、0を無効なIDとして扱い、nullを返します。
 * それ以外の場合は数値として返します。
 *
 * @param {any} value - 正規化する値
 * @returns {number|null} - 正規化されたペルソナID、または無効な場合はnull
 */
function normalizePersonaId(value) {
  // null/undefinedの場合はnullを返す
  if (value === null || value === undefined) {
    return null;
  }

  // 数値に変換して検証
  const num = Number(value);
  if (Number.isNaN(num) || num === 0) {
    return null;
  }

  return num;
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
 * ペルソナIDをフォーマット
 *
 * @param {number} id - ペルソナID
 * @returns {string} - フォーマットされたID文字列
 */
function formatPersonaId(id) {
  if (!id) {
    return '---';
  }

  // IDを3桁の0埋め文字列にフォーマット
  return `${String(id).padStart(3, '0')}`;
}

/**
 * 日時をフォーマット
 *
 * UNIXタイムスタンプ（秒またはミリ秒）を日本語形式（yyyy/MM/dd HH:mm）に変換します。
 *
 * @param {string|number} value - 日時文字列またはタイムスタンプ
 * @returns {string} - フォーマットされた日時文字列、解析できない場合は '-'
 */
function formatDateTime(value) {
  if (value === null || value === undefined) {
    return '-';
  }

  const text = String(value).trim();
  if (!text) {
    return '-';
  }

  if (!/^\d+$/.test(text)) {
    return '-';
  }

  const num = Number(text);
  const date = new Date(text.length === 10 ? num * 1000 : num);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return formatParts(date);
}

function formatParts(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

async function handleRestartClick() {
  const confirmed = await showConfirmModal('Chocolate LM Liteを再起動します。続行しますか?<br><br>再起動には数分掛かります。<br>※外出先などで問題が起きたときに使います。', {
    title: '再起動の確認',
    confirmLabel: '再起動',
    cancelLabel: 'キャンセル',
    variant: 'danger'
  });

  if (!confirmed) {
    return;
  }

  const button = document.getElementById('restartButton');
  if (button) {
    button.disabled = true;
  }

  try {
    fetchJson('/api/system/restart', { method: 'POST' });
    showAlertModal('再起動を開始しました。数分待ってからページを再読み込みしてください。', {
      title: '再起動中',
      confirmLabel: '閉じる'
    });
  } catch (error) {
    console.error('Failed to restart system:', error);
    showAlertModal('再起動に失敗しました。(通信エラー)<br>通信環境を再確認し、再読み込みしてください。', { title: 'エラー' });
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

// モーダルの背景クリックで閉じる機能を追加
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', event => {
    // モーダルの背景（オーバーレイ）をクリックした場合のみ閉じる
    if (event.target === modal) {
      modal.classList.remove('active');
    }
  });
});
