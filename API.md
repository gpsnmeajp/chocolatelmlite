## Chocolate LM Lite APIリファレンス (REST + WebSocket)

Chocolate LM Liteは、会話履歴・ペルソナ・設定を操作できるREST APIと、生成進捗を受け取るWebSocketを提供します。本ドキュメントでは、実際のコード実装（`src/WebServer.cs`, `src/Persona.cs`, `src/FileManager.cs` など）の挙動に基づいたAPI仕様を説明し、各エンドポイントの使用例として`curl`コマンドを記載しています。

### 基本情報

#### ベースURL
デフォルトでは `http://localhost:8010` でアクセスできます。

#### 認証
基本的に認証は不要です。ただし、以下の設定により制限をかけることができます：
- `LocalOnly=true`: サーバーをローカルホストからのアクセスのみに制限します(既定で無効)
- `SystemSettingsLocalOnly=true`: 全体設定の更新をローカルホストからのみ許可します(既定で有効)

#### コンテンツタイプ
- 通常のリクエスト: `application/json`
- 添付ファイルのアップロード: `multipart/form-data`
- アイコン画像の更新: 生バイト列（バイナリ）

#### タイムアウト
LLM呼び出しなどのタイムアウトは、設定の`TimeoutSeconds`で指定します（デフォルト: 180秒）。

#### エラーレスポンス
エラー時は以下の形式でHTTP 4xx/5xxステータスコードとともに返されます：
```json
{ "error": "エラーメッセージ" }
```

### リクエスト送信時の注意事項

#### JSONキーの形式
すべてのJSONキーはPascalCase形式で記述してください（例: `LlmEndpointUrl`, `Uuid`, `AttachmentId`）。

#### 不明なキーの扱い
設定やキーワードナレッジの更新時など、APIが認識できないキーは無視されます。

#### 画像のアップロード
- 危険な拡張子を持つファイルはアップロード時に拒否されます
- 画像は自動的にリサイズされ、PNG形式に変換されます

---

## REST API

本セクションでは、クライアントからChocolate LM Liteへ送信するAPIエンドポイントについて説明します。

### システム操作

#### POST /api/system/restart
サーバーの再起動を要求します。リクエストに対して即座に応答した後、プロセスが終了します。  
サーバーが異常を起こしたときや、設定変更後に再起動したい場合に使用します。

**レスポンス例**
```json
{
	"status": "サーバーを再起動します。"
}
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/system/restart
```

### 全体設定

#### GET /api/setting
システム全体の設定を取得します。APIキーなどの機密情報はマスクされた状態で返されます。

**レスポンス例**
```json
{
	"settings": {
		"LlmEndpointUrl": "https://api.example.com/v1",
		"LlmApiKey": "************",
		"DefaultModel": "google/gemini-2.5-flash",
		"YourName": "あなた",
		"BreakReminderThreshold": 60,
		"TalkHistoryCutoffThreshold": 40000,
		"LocalOnly": false,
		"TimeoutSeconds": 180,
		"Temperature": 0.7,
		"MaxTokens": 8192,
		"TimerGenerateLimitMax": 30,
		"PhotoCutoff": 10,
		"TimerGenerateMessage": "タイマーイベント: 自由に独り言を言ったり、ツールを呼び出したりすることが出来ます。",
		"TimeZone": "Asia/Tokyo",
		"HttpPort": 8010,
		"SystemSettingsLocalOnly": true,
		"EnableHowto": true,
		"EnableMemory": true,
		"EnableJavascript": true,
		"EnableProject": true,
		"EnableTimestamps": true,
		"EnableCurrentTime": true,
		"EnableStatisticsAndBreakReminder": true,
		"EnableWebhook": false,
		"EnableDynamicContext": false,
		"EnableAutoUpdateCheck": true,
		"EnableConsoleMonitor": true,
		"EnableTimerGenerate": false,
		"EnableMcpTools": false,
		"EnableImageGeneration": false,
		"ImageGenerationEndpointUrl": "",
		"ImageGenerationApiKey": "************",
		"ImageGenerationModel": "google/gemini-2.5-flash-image",
		"DebugMode": false
	}
}
```

**curlコマンド例**
```bash
curl http://localhost:8010/api/setting
```

#### POST /api/setting
システム全体の設定を更新します。`SystemSettingsLocalOnly=true`の場合、ローカルホストからのリクエストのみが許可されます。

**リクエスト例**
```json
{
	"LlmEndpointUrl": "https://api.example.com/v1",
	"LlmApiKey": "sk-xxxx",
	"DefaultModel": "my-model-1",
	"Temperature": 0.5,
	"MaxTokens": 4096,
	"LocalOnly": true,
	"EnableWebhook": true,
	"EnableDynamicContext": true,
	"ImageGenerationEndpointUrl": "https://img.example.com/v1",
	"ImageGenerationApiKey": "img-xxxx"
}
```

**レスポンス例**
```json
{ "success": "done" }
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/setting \
	-H "Content-Type: application/json" \
	-d '{"LlmEndpointUrl":"https://api.example.com/v1","LlmApiKey":"sk-xxxx"}'
```

### ペルソナ管理

#### GET /api/persona
登録されているペルソナの一覧と、現在アクティブなペルソナのIDを取得します。

**レスポンス例**
```json
{
	"personas": [
		{"id":1,"name":"ラウル","timestamp":1762307949}
	],
	"count": 1,
	"active": 1
}
```

**curlコマンド例**
```bash
curl http://localhost:8010/api/persona
```

#### POST /api/persona/new
新しいペルソナを作成します。

**リクエスト例**
```json
{ "name": "New Persona" }
```

**レスポンス例**
```json
{ "id": 2 }
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/persona/new \
	-H "Content-Type: application/json" \
	-d '{"name":"New Persona"}'
```

#### POST /api/persona/duplicate
既存のペルソナを複製して新しいペルソナを作成します。`newName`パラメータは省略可能です。

**リクエスト例**
```json
{ "id": 1, "newName": "Alice copy" }
```

**レスポンス例**
```json
{ "id": 3 }
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/persona/duplicate \
	-H "Content-Type: application/json" \
	-d '{"id":1,"newName":"Alice copy"}'
```

#### POST /api/persona/remove
指定したIDのペルソナを削除します。  
(Windows環境ではゴミ箱に移動します)

**リクエスト例**
```json
{ "id": 3 }
```

**レスポンス例**
```json
{ "success": "done" }
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/persona/remove \
	-H "Content-Type: application/json" \
	-d '{"id":3}'
```

#### GET /api/persona/active
現在アクティブなペルソナのIDを取得します。未設定の場合は0が返されます。

**レスポンス例**
```json
{ "id": 1 }
```

**curlコマンド例**
```bash
curl http://localhost:8010/api/persona/active
```

#### POST /api/persona/active
アクティブなペルソナを切り替えます。LLMによる生成処理が進行中の場合は、自動的にキャンセルされてから切り替えが行われます。

**リクエスト例**
```json
{ "id": 2 }
```

**レスポンス例**
```json
{ "id": 2 }
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/persona/active \
	-H "Content-Type: application/json" \
	-d '{"id":2}'
```

### アクティブペルソナの添付ファイル

#### GET /api/persona/active/attachment
アクティブなペルソナに添付されているファイルのID一覧を取得します。

**レスポンス例**
```json
{ "attachments": [101, 102] }
```

**curlコマンド例**
```bash
curl http://localhost:8010/api/persona/active/attachment
```

#### POST /api/persona/active/attachment
ファイルをアップロードして添付ファイルとして登録します。`multipart/form-data`形式で`file`フィールドにファイルを指定してください。画像は最大1024pxに縮小され、PNG形式に変換されます。危険な拡張子を持つファイルは拒否されます。

**レスポンス例**
```json
{ "id": 103 }
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/persona/active/attachment \
	-F "file=@./sample.png"
```

#### GET /api/persona/active/attachment/{id}
指定したIDの添付ファイルをバイナリ形式で取得します。存在しないIDや危険な拡張子のファイルを指定した場合は404エラーが返されます。

**curlコマンド例**
```bash
curl -OJ http://localhost:8010/api/persona/active/attachment/103
```

### アクティブペルソナのアイコン画像

このセクションでは、ペルソナのアイコン画像（`user.png`, `assistant.png`, `background.png`）を管理するためのエンドポイントを説明します。アップロード時、画像は2048px以内に縮小され、PNG形式に変換されます。

#### GET /api/persona/active/{file}
指定したアイコン画像ファイルをバイナリ形式で取得します。

**curlコマンド例**
```bash
curl -OJ http://localhost:8010/api/persona/active/user.png
```

#### POST /api/persona/active/{file}
指定したアイコン画像ファイルを更新します。リクエストボディには画像の生バイト列（バイナリデータ）を指定してください。

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/persona/active/user.png \
	--data-binary "@./icon.png"
```

### アクティブペルソナのメッセージ

#### メッセージデータ構造
メッセージ（TalkEntry）は以下のフィールドを持ちます。JSONキーはすべてPascalCase形式です：

- `Uuid` (string, 省略可): 既存メッセージの更新時に指定します。省略または`"00000000-0000-0000-0000-000000000000"`を指定すると新規メッセージとして扱われます
- `Role` (string): メッセージの役割を指定します（`System`, `User`, `Assistant`, `Tool`, `ChocolateLM`, `Unknown`のいずれか）
- `Text` (string): メッセージ本文
- `AttachmentId` (int配列, 省略可): 添付ファイルのID配列
- `Timestamp` (number, 設定不要): Unix秒形式のタイムスタンプ。省略時はサーバーの現在時刻が使用されます
- `ToolDetail` (string, 設定不要): ツール実行の詳細情報
- `Reasoning` (string, 設定不要): 推論過程の情報
- `Tokens` (number, 設定不要): トークン数

#### GET /api/persona/active/message
会話履歴を取得します。クエリパラメータで取得範囲を指定できます。

**クエリパラメータ**
- `index`: 開始位置（省略時: 0）。負の値を指定すると末尾から取得します
- `count`: 取得件数（省略時: 50）

**レスポンス例**
```json
{
    "messages": [
        {
            "Uuid": "8e99ed68-8dc3-4a95-a539-b8501c30374b",
            "Role": "user",
            "Text": "この画像見れる？",
            "Reasoning": "",
            "ToolDetail": "",
            "AttachmentId": [
                1
            ],
            "Timestamp": 1767528558,
            "Tokens": 0
        },
        {
            "Uuid": "e26817c9-67ba-4146-88e7-4b66754383c7",
            "Role": "tool",
            "Text": "[Eval] 成功",
            "Reasoning": "",
            "ToolDetail": "{\"call\":{\"code\":\"null\"},\"result\":\"null\"}",
            "Timestamp": 1767528576,
            "Tokens": 18
        },
        {
            "Uuid": "c132eac4-7f0b-40a8-9b20-d9f765137e1a",
            "Role": "assistant",
            "Text": "見えているわけではないが、**コンテキストに以下の情報が提供されている**。  \n赤い髪に赤い服の女性が描かれ、背景は黒の市松模様……。それだけが手元にある情報よ。実際の画像は直接処理できないが、説明はできるわ。",
            "Reasoning": "",
            "ToolDetail": "",
            "Timestamp": 1767528583,
            "Tokens": 79
        }
    ],
    "hash": "d7b7eb49f803bec93b97cbe72372bcaa",
    "total": 123,
    "stats": {
        "Total": 123,
        "Archived": 0,
        "UserLast8h": 3,
        "NeedUserRestRemind": false,
        "TotalTokens": 9461,
        "RawSystemPromptTokens": 653,
        "BuiltSystemPromptTokens": 667
    }
}
```

**curlコマンド例**
```bash
curl "http://localhost:8010/api/persona/active/message?index=-1&count=3"
```

#### POST /api/persona/active/message
新しいメッセージを追加、または既存メッセージを更新します。  
LLMによる生成処理が進行中の場合はエラーレスポンスが返されます。成功時は非同期でLLMによる応答生成が開始されます。  
進捗は即座にWebSocketで接続中の全クライアントに送信されます。


**リクエスト例（新規メッセージ）**
```json
{
	"Role": "User",
	"Text": "こんにちは",
	"AttachmentId": [103],
	"Timestamp": 1700000100
}
```

**レスポンス例**
```json
{"success":"done","uuid":"57164743-1e5f-44a9-8d87-6c32fc79a370"}
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/persona/active/message \
	-H "Content-Type: application/json" \
	-d '{"Role":"User","Text":"Hello world"}'
```

#### POST /api/persona/active/cancel
進行中のLLM生成処理をキャンセルします。  
(実際にキャンセルしたかどうかに関わらずdoneが帰ります。)

**レスポンス例**
```json
{ "success": "done" }
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/persona/active/cancel
```

### アクティブペルソナの設定

#### GET /api/persona/active/setting
アクティブなペルソナの設定とシステムプロンプトを取得します。

**レスポンス例**
```json
{
	"name": "Alice",
	"model": "google/gemini-2.5-flash",
	"timer_cycle_minutes": 0,
	"webhook_url": "",
	"webhook_body": "{\"content\":\"%text%\"}",
	"enable_post_prompt": false,
	"post_prompt": "",
	"enable_dynamic_context": false,
	"dynamic_context_url": "",
	"dynamic_context_history_turns": 8,
	"remove_attachment": false,
	"system_prompt": "あなたは親切なアシスタントです"
}
```

**curlコマンド例**
```bash
curl http://localhost:8010/api/persona/active/setting
```

#### POST /api/persona/active/setting
アクティブなペルソナの設定を更新します。`system_prompt`はプレーンテキストとして保存されます。

**リクエスト例**
```json
{
	"name": "Project Bot",
	"model": "my-model-1",
	"enable_dynamic_context": true,
	"dynamic_context_url": "https://hook.example.com/dc",
	"dynamic_context_history_turns": 6,
	"webhook_url": "https://hook.example.com/notify",
	"webhook_body": "{\"content\":\"%name%: %text%\"}",
	"system_prompt": "You are a PM assistant."
}
```

**レスポンス例**
```json
{ "success": "done" }
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/persona/active/setting \
	-H "Content-Type: application/json" \
	-d '{"name":"Project Bot","model":"my-model-1","enable_dynamic_context":true}'
```

### アクティブペルソナのメモリとキーワードナレッジ

#### GET /api/persona/active/memory
アクティブなペルソナのメモリエントリ一覧を取得します。

**レスポンス例**
```json
{
    "memory_entries": [
        {
            "Id": 1,
            "Text": "ABCD",
            "CreatedAt": "2026-01-04 22:40:09",
            "UpdatedAt": "2026-01-04 22:40:09"
        }
    ],
    "count": 1
}
```

**curlコマンド例**
```bash
curl http://localhost:8010/api/persona/active/memory
```

#### GET /api/persona/active/keyword-knowledge
キーワードナレッジエントリの一覧を取得します。

**レスポンス例**
```json
{
    "keyword_knowledge_entries": [
        {
            "Id": 1,
            "Keyword": "キーワード1",
            "Text": "キーワードの内容"
        }
    ],
    "count": 1
}
```

**curlコマンド例**
```bash
curl http://localhost:8010/api/persona/active/keyword-knowledge
```

#### POST /api/persona/active/keyword-knowledge
キーワードナレッジエントリを追加または更新します。`keyword`パラメータは必須です。`id`を指定すると既存エントリを更新します。

**リクエスト例**
```json
{ "keyword": "C#", "text": ".NET Primary Language" }
```

**レスポンス例**
```json
{
	"success": "done",
	"entry": { "Id": 2, "Keyword": "C#", "Text": ".NET Primary Language" }
}
```

**curlコマンド例**
```bash
curl -X POST http://localhost:8010/api/persona/active/keyword-knowledge \
	-H "Content-Type: application/json" \
	-d '{"keyword":"C#","text":".NET Primary Language"}'
```

#### DELETE /api/persona/active/keyword-knowledge/{id}
指定したIDのキーワードナレッジエントリを削除します。

**レスポンス例**
```json
{ "success": "done" }
```

**curlコマンド例**
```bash
curl -X DELETE http://localhost:8010/api/persona/active/keyword-knowledge/2
```

---

## WebSocket API

WebSocketを使用して、リアルタイムで生成処理の進捗を受け取ることができます。  
同時接続数は、16まで許可されています。(固定)

### 接続情報
- **エンドポイント**: `ws://<host>:<port>/ws`
- **接続維持**: 毎秒 `{ "ping": true }` がサーバーから送信されます。

### イベント
サーバーから以下のようなイベントが送信されます：

- `{ "status": "started" }` - 生成処理が開始されました
- `{ "status": "generating", "response": "partial text" }` - 生成中の応答全文（累積）が逐次送信されます
- `{ "status": "canceled" }` - 生成処理がキャンセルまたはタイムアウトしました
- `{ "status": "completed", "response": "応答", "error": "エラー" }` - 生成処理が完了しました（`error`は成功時は空文字、エラー時はメッセージが入ります）
- `{ "status": "tool_update", "state": "call|result|error", "name": "toolName", ... }` - ツール実行により履歴が更新されました。`state`が`call`のとき`arguments`、`result`のとき`result`、`error`のとき`error`が添付されます

### 接続確認例
WebSocketクライアント（`wscat`）を使用した接続例：
```bash
wscat -c ws://localhost:8010/ws
```

**レスポンス例**
```json
< {"ping":true}
< {"status":"started"}
< {"ping":true}
< {"ping":true}
< {"status":"generating","response":""}
< {"status":"generating","response":""}
< {"status":"generating","response":""}
< {"status":"generating","response":""}
< {"status":"tool_update","state":"call","name":"UpdatePersonaMemory","arguments":"{\"call\":{\"id\":1,\"newContent\":\"\"}}"}
< {"ping":true}
< {"status":"tool_update","state":"result","name":"UpdatePersonaMemory","result":"{\"call\":{\"id\":1,\"newContent\":\"\"},\"result\":\"メモリを削除しました。\"}"}
< {"status":"generating","response":""}
< {"ping":true}
< {"status":"generating","response":""}
< {"status":"generating","response":"AB"}
< {"status":"generating","response":"ABCD"}
< {"status":"generating","response":"ABCD の"}
< {"status":"generating","response":"ABCD の内容"}
< {"status":"generating","response":"ABCD の内容を"}
< {"status":"generating","response":"ABCD の内容を削"}
< {"status":"generating","response":"ABCD の内容を削除"}
< {"status":"generating","response":"ABCD の内容を削除しました"}
< {"status":"generating","response":"ABCD の内容を削除しました。他"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何か"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かあり"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありました"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありましたら"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありましたら、"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありましたら、いつ"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありましたら、いつでも"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありましたら、いつでもお"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありましたら、いつでもお知らせ"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありましたら、いつでもお知らせください"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありましたら、いつでもお知らせください。"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありましたら、いつでもお知らせください。"}
< {"status":"generating","response":"ABCD の内容を削除しました。他に何かありましたら、いつでもお知らせください。"}
< {"status":"completed","response":"ABCD の内容を削除しました。他に何かありましたら、いつでもお知らせください。","error":""}
< {"ping":true}
< {"ping":true}
< {"ping":true}
```

---

## 外部へのAPI呼び出し

Chocolate LM Liteは、特定の条件下で外部のエンドポイントへHTTPリクエストを送信します。

### Webhook（生成完了通知）

アシスタントの応答生成が完了した際に、外部のWebhookエンドポイントへ通知を送信できます。

#### 有効条件
以下の条件をすべて満たす必要があります：
- 全体設定で`EnableWebhook=true`が設定されている
- アクティブなペルソナの設定で`webhook_url`と`webhook_body`が指定されている

#### リクエスト仕様
- **タイミング**: 応答生成完了直後（非同期で送信されます）
- **Content-Type**: `application/json`
- **Body**: `webhook_body`に指定された文字列内のプレースホルダが以下のように置換されます
  - `%text%` → 最終応答テキスト（`<think>`タグは除去されます）
  - `%id%` → ペルソナID
  - `%name%` → ペルソナ名

#### 送信例（置換後）
```json
{"content": "Project Bot: こんにちは！本日はいかがでしょうか？何かお手伝いできることがありましたら、遠慮 なく教えてくださいね。"}
```

#### Pythonサーバー実装例
Flaskを使用したWebhook受信サーバーの例：

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def webhook():
    """
    Chocolate LM LiteからのWebhook通知を受信します。
    webhook_bodyで指定したJSON形式のデータが送信されます。
    """
    data = request.get_json()
    
    # 受信したデータを詳細にログ出力
    print("=" * 5)
    print("[Webhook受信]")
    print(f"受信データ: {data}")
    print(f"Content-Type: {request.content_type}")
    print(f"送信元IP: {request.remote_addr}")
    print("=" * 5)
            
    return jsonify({"status": "ok"}), 200

if __name__ == '__main__':
    # ポート5000で起動
    app.run(host='0.0.0.0', port=5000, debug=True)
```

**使用方法：**
1. Flask をインストール: `pip install flask`
2. サーバーを起動: `python webhook_server.py`
3. Chocolate LM Liteのペルソナ設定で以下を指定:
   - `webhook_url`: `http://localhost:5000/webhook`
   - `webhook_body`: `{"content":"%name%: %text%"}`

**出力例**
```
=====
[Webhook受信]
受信データ: {'content': 'Project Bot: テスト、了解しました！何か試したいことやご質問があれば、遠慮なくどうぞ。'}
Content-Type: application/json; charset=utf-8
送信元IP: 127.0.0.1
=====
127.0.0.1 - - [04/Jan/2026 22:58:25] "POST /webhook HTTP/1.1" 200 -
```

### Dynamic Context（前処理フック）

ユーザーの入力をLLMへ送信する前に、外部エンドポイントから追加のコンテキスト情報を取得できます。

#### 有効条件
以下の条件をすべて満たす必要があります：
- 全体設定で`EnableDynamicContext=true`が設定されている
- アクティブなペルソナの設定で`enable_dynamic_context=true`が設定されている
- アクティブなペルソナの設定で`dynamic_context_url`が指定されている

#### リクエスト仕様
- **タイミング**: ユーザーの発言をLLMへ送信する直前
- **メソッド**: POST
- **Content-Type**: `application/json`

#### リクエストボディ例
```json
{
    "text": "いいですね",
    "persona": {
        "id": 40,
        "name": "Project Bot"
    },
    "history": [
        {
            "role": "user",
            "text": "今の天気を教えて下さい",
            "uuid": "09bcc1cc-c11e-4925-92bb-cc27ebe97639",
            "timestamp": 1767535245,
            "toolDetail": ""
        },
        {
            "role": "assistant",
            "text": "現在、東京は晴れで、気温は約22℃です。 快適な夜ですね！他にも知りたいことがあれば教えてください。",
            "uuid": "58a3d300-6d7b-4c3f-a85c-07226d695f26",
            "timestamp": 1767535250,
            "toolDetail": ""
        },
        {
            "role": "user",
            "text": "いいですね",
            "uuid": "39b62d6b-a309-447c-a165-28f70d8cc992",
            "timestamp": 1767535307,
            "toolDetail": "",
            "attachmentId": [
                2
            ]
        }
    ],
    "latest_user_attachments": [
        {
            "id": 2,
            "filename": "attachment_2.png",
            "contentType": "image/png",
            "data_base64": "iVBORw0KGgoAAA..."
        }
    ]
}
```

#### レスポンス仕様
- **形式**: プレーンテキスト
- **動作**: 空文字列以外が返された場合、その内容がシステムプロンプトに追記されます。空文字列の場合は何も追記されません
- **エラー処理**: エラーが発生した場合(200以外)は処理が中断され、ユーザーにエラーメッセージが返されます。

#### Pythonサーバー実装例
Flaskを使用したDynamic Contextサーバーの例：

```python
from flask import Flask, request
from datetime import datetime

app = Flask(__name__)

@app.route('/dynamic-context', methods=['POST'])
def dynamic_context():
    """
    Chocolate LM Liteからのコンテキスト要求に応答します。
    返されたテキストはシステムプロンプトに追記されます。
    """
    data = request.get_json()
    
    # リクエストに含まれる情報:
    # - text: 最新のユーザー入力
    # - persona: {"id": 1, "name": "Alice"}
    # - history: 過去の会話履歴（指定されたターン数分）
    # - latest_user_attachments: 最新の添付ファイル情報
    
    user_text = data.get('text', '')
    persona = data.get('persona', {})
    persona_name = persona.get('name', '')
    persona_id = persona.get('id', 0)
    history = data.get('history', [])
    history_count = len(history)
    attachments = data.get('latest_user_attachments', [])
    
    # 受信したデータを詳細にログ出力
    print("=" * 50)
    print("[Dynamic Context リクエスト受信]")
    print(f"ペルソナ: {persona_name} (ID: {persona_id})")
    print(f"ユーザー入力: {user_text}")
    print(f"履歴件数: {history_count}")
    print(f"添付ファイル数: {len(attachments)}")
    if history_count > 0:
        print("\n[会話履歴]")
        for i, msg in enumerate(history, 1):
            role = msg.get('role', 'unknown')
            text = msg.get('text', '')[:50]  # 最初の50文字のみ表示
            print(f"  {i}. [{role}] {text}...")
    if attachments:
        print("\n[添付ファイル]")
        for att in attachments:
            filename = att.get('filename', 'unknown')
            content_type = att.get('contentType', 'unknown')
            print(f"  - {filename} ({content_type})")
    print("=" * 50)
    
    # 例1: 現在の状況を追加コンテキストとして提供
    current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    context = f"[追加コンテキスト] 現在時刻: {current_time}\n"
    
    # 例2: ユーザー入力に基づいて動的に情報を追加
    if 'weather' in user_text.lower() or '天気' in user_text:
        context += "天気情報: 東京は晴れ、気温22度です。\n"
    
    # 例3: 外部APIから情報を取得して追加することも可能
    # import requests
    # api_data = requests.get('https://api.example.com/data').json()
    # context += f"API情報: {api_data}\n"
    
    # 例4: 会話履歴の長さに応じて処理を変更
    if history_count > 10:
        context += "注意: 会話が長くなっています。要点をまとめることを推奨します。\n"
    
    # 空文字列を返すと何も追記されません
    # return "", 200
    
    # コンテキストを返す（プレーンテキスト）
    print(f"返却コンテキスト:\n{context}")
    return context, 200, {'Content-Type': 'text/plain; charset=utf-8'}

if __name__ == '__main__':
    # ポート5001で起動
    app.run(host='0.0.0.0', port=5001, debug=True)
```

**使用方法：**
1. Flask をインストール: `pip install flask`
2. サーバーを起動: `python dynamic_context_server.py`
3. Chocolate LM Liteの全体設定で`EnableDynamicContext`を`true`に設定
4. ペルソナ設定で以下を指定:
   - `enable_dynamic_context`: `true`
   - `dynamic_context_url`: `http://localhost:5001/dynamic-context`
   - `dynamic_context_history_turns`: `8` (送信する履歴のターン数)

**出力例**
```
127.0.0.1 - - [04/Jan/2026 22:59:54] "POST /dynamic-context HTTP/1.1" 200 -
==================================================
[Dynamic Context リクエスト受信]
ペルソナ: Project Bot (ID: 40)
ユーザー入力: 今の天気を教えて下さい
履歴件数: 8
添付ファイル数: 0

[会話履歴]
  1. [assistant] こんにちは！本日はいかがでしょうか？何かお手伝いできることがありましたら、遠慮なく教えてくださいね。...
  2. [user] ありがとうございます...
  3. [assistant] どういたしまして！お役に立てて嬉しいです。ほかにもご質問やご要望がありましたら、遠慮なくどうぞ。...
  4. [user] これはテストです...
  5. [assistant] テスト、了解しました！何か試したいことやご質問があれば、遠慮なくどうぞ。...
  6. [user] もう一度テストしますね...
  7. [assistant] 了解です！テスト、いつでもどうぞ。何かご質問や試したいことがあればお知らせくださいね。...     
  8. [user] 今の天気を教えて下さい...
==================================================
返却コンテキスト:
[追加コンテキスト] 現在時刻: 2026-01-04 23:00:47
天気情報: 東京は晴れ、気温22度です。
```

**応用例：**
- 外部データベースからユーザー情報を取得してコンテキストに追加
- 外部APIから最新のニュースや天気情報を取得
- 会話履歴を分析して、話題の変化を検出・要約
- ユーザーの入力に含まれるキーワードに基づいて関連情報を提供
- 添付画像の内容を解析してコンテキストに反映(非マルチモーダルモデル利用時など)
