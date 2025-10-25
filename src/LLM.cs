using System;
using System.ClientModel;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.AI;
using OpenAI;
using System.Runtime.CompilerServices;
using System.ClientModel.Primitives;
using Microsoft.Extensions.Logging;

namespace CllDotnet
{
    public class LLM
    {
        FileManager fileManager;
        ConsoleMonitor consoleMonitor;
        CancellationTokenSource cancellationTokenSource = new CancellationTokenSource();
        volatile bool isGenerating = false;
        Tools tools;
        string responseText = "";
        public LLM(FileManager fileManager, ConsoleMonitor consoleMonitor, Tools tools)
        {
            this.fileManager = fileManager;
            this.consoleMonitor = consoleMonitor;
            this.tools = tools;
        }

        public void AllContentLogger(string prefix, IList<AIContent> contents)
        {
            for (int i = 0; i < contents.Count; i++)
            {
                var content = contents[i];
                switch (content)
                {
                    case DataContent dc:
                        MyLog.LogWrite($"{prefix}: content[{i}] (DataContent): {dc.Name}, {dc.MediaType}, {dc.Data.Length} bytes");
                        break;
                    case ErrorContent ec:
                        MyLog.LogWrite($"{prefix}: content[{i}] (ErrorContent): Message: {ec.Message} Details: {ec.Details}");
                        break;
                    case FunctionCallContent fcc:
                        MyLog.LogWrite($"{prefix}: content[{i}] (FunctionCallContent): {fcc.CallId} {fcc.Name}, Arguments: {Serializer.JsonSerialize(fcc.Arguments, false)}");
                        break;
                    case FunctionResultContent frc:
                        MyLog.LogWrite($"{prefix}: content[{i}] (FunctionResultContent): {frc.CallId}, Result: {Serializer.JsonSerialize(frc.Result, false)} exception: {frc.Exception}");
                        break;
                    case HostedFileContent hfc:
                        MyLog.LogWrite($"{prefix}: content[{i}] (HostedFileContent): {hfc.FileId}");
                        break;
                    case HostedVectorStoreContent hvsc:
                        MyLog.LogWrite($"{prefix}: content[{i}] (HostedVectorStoreContent): {hvsc.VectorStoreId}");
                        break;
                    case TextContent tc:
                        MyLog.LogWrite($"{prefix}: content[{i}] (TextContent): {tc.Text}");
                        break;
                    case TextReasoningContent trc:
                        MyLog.LogWrite($"{prefix}: content[{i}] (TextReasoningContent): {trc.Text} {trc.ProtectedData}");
                        break;
                    case UriContent uc:
                        MyLog.LogWrite($"{prefix}: content[{i}] (UriContent): {uc.Uri} {uc.MediaType}");
                        break;
                    case UsageContent usc:
                        MyLog.LogWrite($"{prefix}: content[{i}] (UsageContent): InputTokenCount: {usc.Details.InputTokenCount} OutputTokenCount: {usc.Details.OutputTokenCount} TotalTokenCount: {usc.Details.TotalTokenCount}");
                        break;
                    default:
                        MyLog.LogWrite($"{prefix}: content[{i}] (Unknown Content Type): {content.GetType().FullName}");
                        break;
                }
            }
        }

        public void CancelGeneration()
        {
            if (cancellationTokenSource != null)
            {
                try
                {
                    cancellationTokenSource.Cancel();
                }catch (ObjectDisposedException)
                {
                    // すでにDisposeされている場合は無視
                }
            }
            MyLog.LogWrite("LLM生成のキャンセルを要求しました。");
        }

        public bool IsGenerating()
        {
            return isGenerating;
        }

        public async Task<bool> GenerateResponseAsync()
        {
            // LLM処理キャンセル用トークン
            using (var c = new CancellationTokenSource())
            {
                using (cancellationTokenSource = CancellationTokenSource.CreateLinkedTokenSource(c.Token, Program.cts.Token))
                {
                    isGenerating = true;
                    tools.isImageGenerated = false; // 連続作成制限を解除

                    try
                    {
                        responseText = "";
                        var cancellationToken = cancellationTokenSource.Token;
                        var activePersonaSettings = fileManager.GetActivePersonaSettings();
                        var model = activePersonaSettings.Model;
                        _ = fileManager.LoadGeneralSettings(); // 全体設定を反映しておく(LLMパラメータなどあるため)

                        if (string.IsNullOrEmpty(model))
                        {
                            model = fileManager.generalSettings.DefaultModel;
                        }
                        MyLog.LogWrite($"LLMモデル: {model}");
                        // カスタムHttpHandlerを作成
                        var httpHandler = new OpenRouterHttpHandler(fileManager);
                        var openAIClientOptions = new OpenAIClientOptions()
                        {
                            Endpoint = new Uri(fileManager.generalSettings.LlmEndpointUrl),
                            Transport = new HttpClientPipelineTransport(
                                new HttpClient(httpHandler)
                                {
                                    Timeout = TimeSpan.FromSeconds(fileManager.generalSettings.TimeoutSeconds),
                                }
                            ),
                        };
                        MyLog.LogWrite($"LLMエンドポイント: {openAIClientOptions.Endpoint}");

                        // メモ: MSのOpenAIクライアントラッパーも、OpenAIのSDK地獄のような作りになっており、
                        // オプションを与えるためのoverrideなどができない。reasoning_effortなどを与えたいが、方法を見つける必要がある。
                        // (あるいはChatClinetを時前で再実装する)

                        var chatClient = new OpenAI.Chat.ChatClient(
                            model: model ?? "-",
                            new ApiKeyCredential(fileManager.generalSettings.LlmApiKey ?? "-"), // ローカルLLM等では空文字が許容される場合があるため、null合体演算子で"-"を渡す
                            openAIClientOptions
                        );
                        MyLog.LogWrite($"APIキーの長さ: {fileManager.generalSettings.LlmApiKey?.Length}文字");

                        // ツール呼び出しの構成
                        var client = ChatClientBuilderChatClientExtensions
                            .AsBuilder(chatClient.AsIChatClient())
                            .Use(async (IEnumerable<ChatMessage> messages, ChatOptions? options, Func<IEnumerable<ChatMessage>, ChatOptions?, CancellationToken, Task> innerClient, CancellationToken cancellationToken) =>
                            {
                                // デバッグ用のメッセージ内容ログ出力
                                /*
                                var messageList = messages.ToList();
                                if(messageList.Count > 0)
                                {
                                    var firstMessage = messageList[0];
                                    AllContentLogger("[0]", firstMessage.Contents);

                                    var lastMessage = messageList[messageList.Count - 1];
                                    AllContentLogger("[last]", lastMessage.Contents);
                                }
                                */
                                await innerClient(messages, options, cancellationToken);
                            })
                            .UseFunctionInvocation(configure: options =>
                            {
                                options.MaximumIterationsPerRequest = 30;
                                options.AllowConcurrentInvocation = false;
                                options.FunctionInvoker = MyFunctionInvoker;
                            }
                            )
                            .Build();

                        var systemprompt = SystemPrompt.BuildSystemPrompt(fileManager);
                        MyLog.LogWrite($"システムプロンプト: {systemprompt.Length}文字");

                        var talks = fileManager.GetAllTalkHistoryAllFromActivePersonaCached();
                        var messages = Tokens.TrimTalkTokens(systemprompt, talks, fileManager.generalSettings.TalkHistoryCutoffThreshold);
                        messages = PhotoCutoff(new List<TalkEntry>(messages));
                        if (messages.Count == 0)
                        {
                            var stat = fileManager.GetTalkStatsFromActivePersona();
                            MyLog.LogWrite($"トーク履歴がすべてカットオフされました。生成を中止します。全システムプロンプトトークン数: {stat?.BuiltSystemPromptTokens} ユーザー入力システムプロンプトトークン数: {stat?.RawSystemPromptTokens}");
                            var entryEx = new TalkEntry
                            {
                                Uuid = Guid.Empty,
                                Role = TalkRole.ChocolateLM,
                                Text = $"【Chocolate LM Lite システムエラー】\n会話履歴が全てカットオフされてしまいました。(履歴総数 == 切捨数)\n一言も話しかけることが出来ないため、このままでは会話が成立しません。\n\nトークン上限(TalkHistoryCutoffThreshold)が低すぎるか、システムプロンプトやメモリが大きすぎます。\n(あるいはツールが多すぎる、プロジェクトファイルが多すぎる、直前の発言が巨大すぎるなどもありえます。)\n上限を増やせない場合は、不要な機能を徹底的にオフにすることで解決することがあります。\n\n＊＊＊＊＊\n+ トークン数上限(TalkHistoryCutoffThreshold): {fileManager.generalSettings.TalkHistoryCutoffThreshold}\n+ 全システムプロンプトトークン数: {stat?.BuiltSystemPromptTokens}\n+ うち、ユーザー入力システムプロンプトトークン数: {stat?.RawSystemPromptTokens}\n\n＊＊＊＊＊\n\n{(fileManager.generalSettings.TalkHistoryCutoffThreshold < 32000 ? "⚠️トークン上限(TalkHistoryCutoffThreshold)が 32K 未満のようです(小さすぎる)。設定ミスを疑ってください。\n\n" : "")}※直前の入力が巨大すぎる場合を除き、会話履歴を削除・作り直ししてもこの問題はまず解決しません。\n上記いずれかの設定項目を調整してください。",
                                ToolDetail = "",
                                AttachmentId = null,
                                Timestamp = new DateTimeOffset(DateTime.UtcNow).ToUnixTimeSeconds()
                            };

                            fileManager.UpsertTalkHistoryToActivePersona(entryEx);
                            await Broadcaster.Broadcast(new Dictionary<string, object> { { "status", "completed" } });
                            isGenerating = false;
                            return false;
                        }

                        List<TalkEntry> mergedMessages = mergeRoleConsecutiveMessages(messages) ?? new List<TalkEntry>();
                        List<ChatMessage> chatMessages = talkEntryListToChatMessageList(mergedMessages, systemprompt);

                        // デバッグ出力
                        if (fileManager.generalSettings.DebugMode)
                        {
                            MyLog.DebugFileWrite("chat_messages.json", Serializer.JsonSerialize(chatMessages, true));
                        }

                        MyLog.LogWrite($"生成開始...");
                        await Broadcaster.Broadcast(new Dictionary<string, object> { { "status", "started" } });
                        ChatResponse? response = null;
                        try
                        {
                            // ストリーミングで応答を取得開始
                            List<ChatResponseUpdate> updates = [];

                            // タイムアウト設定
                            using var timeoutCts = new CancellationTokenSource();
                            timeoutCts.CancelAfter(TimeSpan.FromSeconds(fileManager.generalSettings.TimeoutSeconds));
                            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

                            var toolsList = await tools.GetAvailableTools();

                            MyLog.LogWrite($"タイムアウト設定: {fileManager.generalSettings.TimeoutSeconds}秒");
                            MyLog.LogWrite($"ツール: [{string.Join(", ", toolsList.Select(t => t.Name))}]");
                            MyLog.LogWrite($"Temperature: {fileManager.generalSettings.Temperature}");
                            MyLog.LogWrite($"MaxOutputTokens: {fileManager.generalSettings.MaxTokens}");

                            // ストリーミングで応答を取得
                            await foreach (ChatResponseUpdate update in
                                client.GetStreamingResponseAsync(chatMessages, new ChatOptions()
                                {
                                    Temperature = (float)fileManager.generalSettings.Temperature,
                                    ToolMode = ChatToolMode.Auto,
                                    Tools = toolsList,
                                    MaxOutputTokens = fileManager.generalSettings.MaxTokens
                                }, linkedCts.Token))
                            {
                                responseText += update.Text;
                                updates.Add(update);
                                response = updates.ToChatResponse();
                                // MyLog.LogWrite($"[進行中] {response.Text}");
                                await Broadcaster.Broadcast(new Dictionary<string, object> { { "status", "generating" }, { "response", responseText } });
                                Program.cts.Token.ThrowIfCancellationRequested();
                            }

                        }
                        catch (OperationCanceledException)
                        {
                            MyLog.LogWrite("生成がキャンセルされたか、タイムアウトしました。");
                            // その時点までの応答を応答とする。
                            await Broadcaster.Broadcast(new Dictionary<string, object> { { "status", "canceled" } });
                        }
                        catch (Exception ex)
                        {
                            MyLog.LogWrite($"生成中にエラーが発生しました: {ex.Message} {ex.StackTrace}");
                            AllContentLogger("[result]", response?.Messages.LastOrDefault()?.Contents ?? []);
                            string addition = "不明な通信異常";

                            // ステータスコードに応じた追加メッセージ
                            var statusCodeEx = httpHandler.lastStatusCode;

                            switch (statusCodeEx)
                            {
                                case 0:
                                    addition = "ネットワークに接続できません。エンドポイントURLやネットワーク環境をご確認ください。";
                                    break;
                                case 400:
                                    addition = "リクエストが不正です。入力値の不足・形式の誤り、またはCORSの問題が考えられます。";
                                    break;
                                case 401:
                                    addition = "認証に失敗しました。APIキーが無効か期限切れの可能性があります。";
                                    break;
                                case 402:
                                    addition = "クレジット残高不足です。クレジットを追加して再試行してください。";
                                    break;
                                case 403:
                                    addition = "利用が許可されていない、URLが間違っている、あるいは、入力が有害と判断され拒否されました。内容を見直してください。";
                                    break;
                                case 404:
                                    addition = "モデルが見つかりません。モデル名が正しいか確認してください。";
                                    break;
                                case 408:
                                    addition = "タイムアウトしました。再試行するか、Base URLやネットワーク環境をご確認ください。";
                                    break;
                                case 429:
                                    addition = "リクエストが多すぎます。しばらく待ってから再試行してください。";
                                    break;
                                case 500:
                                    addition = "サーバー内部に問題が発生しています。しばらく待ってから再試行してください。";
                                    break;
                                case 502:
                                    addition = "通信に失敗しました。接続先が合っている場合、選択したモデルがダウンしているか、不正な応答を返しました。モデル変更や再試行を検討してください。";
                                    break;
                                case 503:
                                    addition = "要求を満たすプロバイダが見つかりません。ルーティング条件やモデル設定を見直してください。";
                                    break;
                            }
                            MyLog.LogWrite($"HTTPステータスコード: {statusCodeEx} {addition}");

                            var text = $"【Chocolate LM Lite システムエラー】\n生成中にエラーが発生し、処理が中断されました。\n編集して再送信することでリトライできます。 \n理由: {statusCodeEx} {addition}";
                            AppendTalkEntry(TalkRole.ChocolateLM, text, ex.Message);

                            await Broadcaster.Broadcast(new Dictionary<string, object> { { "status", "completed" } });
                            isGenerating = false;
                            return false;
                        }

                        var statusCode = httpHandler.lastStatusCode;
                        MyLog.LogWrite($"HTTPステータスコード: {statusCode}");
                        MyLog.LogWrite($"[生成完了] {response?.Text}");
                        AllContentLogger("[result]", response?.Messages.LastOrDefault()?.Contents ?? []);
                        var usc = response?.Usage;
                        if (usc != null)
                        {
                            MyLog.LogWrite($"トークン使用量: 入力 {usc.InputTokenCount} トークン, 出力 {usc.OutputTokenCount} トークン, 合計 {usc.TotalTokenCount} トークン");
                        }

                        string finalResponseText = responseText ?? ""; // ツール呼び出しの度にresponseTextがクリアされるため、最終的なresponseTextを使用する(responseからだと全文入ってしまうため)
                        string finalReasoningText = response?.Messages.LastOrDefault()?.Contents
                            .OfType<TextReasoningContent>()
                            .FirstOrDefault()?.Text ?? "";

                        // <think></think>タグに囲まれている内容は、finalReasoningTextに格納する
                        var reasoningMatch = System.Text.RegularExpressions.Regex.Match(finalResponseText, @"<think>(.*?)<\/think>", System.Text.RegularExpressions.RegexOptions.Singleline);
                        if (reasoningMatch.Success)
                        {
                            finalReasoningText = reasoningMatch.Groups[1].Value.Trim();
                            // finalResponseTextからは、<think>タグを削除する
                            finalResponseText = System.Text.RegularExpressions.Regex.Replace(finalResponseText, @"<think>.*?<\/think>", "", System.Text.RegularExpressions.RegexOptions.Singleline).Trim();
                        }

                        AppendTalkEntry(TalkRole.Assistant, finalResponseText, finalReasoningText);

                        await Broadcaster.Broadcast(new Dictionary<string, object> { { "status", "completed" } });

                        // 生成完了Webhook
                        if (fileManager.generalSettings.EnableWebhook)
                        {
                            if (!string.IsNullOrEmpty(activePersonaSettings.WebhookUrl) && !string.IsNullOrEmpty(activePersonaSettings.WebhookBody))
                            {
                                _ = Task.Run(async () =>
                                {
                                    try
                                    {
                                        var webhookBody = activePersonaSettings.WebhookBody ?? "";
                                        webhookBody = webhookBody.Replace("%text%", Serializer.JsonSerialize<string>(finalResponseText, false).Replace("\"", ""));
                                        MyLog.LogWrite($"Webhook送信準備: URL={activePersonaSettings.WebhookUrl} Body={webhookBody}");

                                        using var httpClient = new HttpClient();
                                        var content = new StringContent(webhookBody, System.Text.Encoding.UTF8, "application/json");
                                        var responseWebhook = await httpClient.PostAsync(activePersonaSettings.WebhookUrl, content);
                                        MyLog.LogWrite($"Webhook送信完了: ステータスコード {responseWebhook.StatusCode}");
                                    }
                                    catch (Exception ex)
                                    {
                                        MyLog.LogWrite($"Webhook送信エラー: {ex.Message} {ex.StackTrace}");
                                    }
                                });
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        MyLog.LogWrite($"LLM生成処理中に予期せぬエラーが発生しました: {ex.Message} {ex.StackTrace}");

                        var text = $"【Chocolate LM Lite システムエラー】\n予期せぬ異常が発生し、処理が中断されました。\n編集して再送信することでリトライできます。";
                        AppendTalkEntry(TalkRole.ChocolateLM, text, ex.Message);

                        await Broadcaster.Broadcast(new Dictionary<string, object> { { "status", "completed" } });
                        isGenerating = false;
                        return false;
                    }
                    finally
                    {
                        isGenerating = false;
                        MyLog.LogWrite("生成処理が終了しました。");
                    }
                }
            }
            return true;
        }

        private List<ChatMessage> talkEntryListToChatMessageList(List<TalkEntry> messages, string systemprompt)
        {
            // チャットメッセージの構築
            List<ChatMessage> chatMessages =
            [
                new ChatMessage()
                {
                    Role = ChatRole.System,
                    Contents = [new TextContent(systemprompt)]
                },
            ];

            // チャットメッセージに変換
            foreach (var message in messages)
            {
                string text = message.Text;

                // ツール詳細があれば追加
                if (!string.IsNullOrEmpty(message.ToolDetail))
                {
                    text += $"\n\n{message.ToolDetail}";
                }

                // タイムスタンプが有効ならユーザーロールでのみ追加
                if (fileManager.generalSettings.EnableTimestamps && message.Timestamp > 0 && (message.Role == TalkRole.User || message.Role == TalkRole.ChocolateLM))
                {
                    // タイムゾーンからローカル現在時刻を取得
                    var timeZone = fileManager.GetTimeZoneInfo();
                    var utc = DateTimeOffset.FromUnixTimeSeconds(message.Timestamp).UtcDateTime;
                    var dt = TimeZoneInfo.ConvertTime(utc, timeZone);
                    string datetimeString = dt.ToString("yyyy-MM-dd (ddd) HH:mm:ss");
                    text += $"\n\n<timestamp>{datetimeString}</timestamp>";
                }

                List<AIContent> contents = [new TextContent(text)];
                // 画像を含む場合、添付ファイルをContentに追加(ただし、ユーザーロール以外正しく扱えないみたいなのでユーザーロール時のみ)
                if (message.AttachmentId != null && message.Role == TalkRole.User)
                {
                    foreach (var attId in message.AttachmentId)
                    {
                        var file = fileManager.GetAttachmentFromActivePersona(attId);
                        if (file == null)
                        {
                            continue;
                        }
                        var extension = Path.GetExtension(file.Value.filename).ToLower();
                        string contentType = extension switch
                        {
                            ".txt" => "text/plain",
                            ".webp" => "image/webp",
                            ".gif" => "image/gif",
                            ".jpg" => "image/jpeg",
                            ".png" => "image/png",
                            _ => "application/octet-stream",
                        };

                        contents.Add(new DataContent(file.Value.data, contentType));
                    }
                }

                switch (message.Role)
                {
                    case TalkRole.ChocolateLM: // ChocolateLMロールはユーザーロールとして扱う
                        chatMessages.Add(new ChatMessage()
                        {
                            Role = ChatRole.User,
                            Contents = contents
                        });
                        break;
                    case TalkRole.User:
                        chatMessages.Add(new ChatMessage()
                        {
                            Role = ChatRole.User,
                            Contents = contents
                        });
                        break;
                    case TalkRole.Assistant:
                        chatMessages.Add(new ChatMessage()
                        {
                            Role = ChatRole.Assistant,
                            Contents = contents
                        });
                        break;
                    case TalkRole.Tool:
                        chatMessages.Add(new ChatMessage()
                        {
                            Role = ChatRole.Tool,
                            Contents = contents
                        });
                        break;
                    default:
                        // 不明なロールは無視
                        MyLog.LogWrite($"不明なロールのメッセージを無視しました: {message.Role} {message.Text}");
                        break;
                }
            }
            return chatMessages;
        }

        // 同じロールが連続しているメッセージを統合する
        private List<TalkEntry> mergeRoleConsecutiveMessages(List<TalkEntry> messages)
        {
            List<TalkEntry> mergedMessages = new List<TalkEntry>();
            var lastMessage = null as TalkEntry;
            // 同じロールが連続しているものは、統合する。(その際UUIDはEmptyにする)
            foreach (TalkEntry message in messages)
            {
                if (message == null) { continue; }

                // もし、同じロールが連続している場合
                if (lastMessage != null && message.Role == lastMessage.Role)
                {
                    // メッセージを結合する
                    lastMessage.Text += "\n\n" + message.Text;
                    if (!string.IsNullOrEmpty(message.ToolDetail))
                    {
                        if (string.IsNullOrEmpty(lastMessage.ToolDetail))
                        {
                            lastMessage.ToolDetail = message.ToolDetail;
                        }
                        else
                        {
                            lastMessage.ToolDetail += "\n\n" + message.ToolDetail;
                        }
                    }
                    if (message.AttachmentId != null)
                    {
                        if (lastMessage.AttachmentId == null)
                        {
                            lastMessage.AttachmentId = new List<int>();
                        }
                        lastMessage.AttachmentId.AddRange(message.AttachmentId);
                    }
                }
                else
                {
                    // 新しいロールの場合は、lastMessageを追加して、新しいメッセージを開始する
                    if (lastMessage != null)
                    {
                        mergedMessages.Add(lastMessage);
                    }
                    lastMessage = new TalkEntry()
                    {
                        Uuid = Guid.Empty,
                        Role = message.Role,
                        Text = message.Text,
                        ToolDetail = message.ToolDetail,
                        AttachmentId = message.AttachmentId != null ? new List<int>(message.AttachmentId) : null,
                        Timestamp = message.Timestamp
                    };
                }
            }

            // 最後のメッセージを追加
            if (lastMessage != null)
            {
                mergedMessages.Add(lastMessage);
            }
            return mergedMessages;
        }

        // ツール呼び出しの実装
        private async ValueTask<object?> MyFunctionInvoker(FunctionInvocationContext context, CancellationToken cancellationToken)
        {
            // ロック獲得済みのLLM生成処理から呼ばれることを想定しているため、ここでの排他制御は不要

            var argJson = Serializer.JsonSerialize(new Dictionary<string, object?> { { "call", context.Arguments } }, false);
            MyLog.LogWrite($"関数呼び出し: {context.Function.Name}({argJson}) を実行中...");

            // 関数呼出しされた時点でアシスタントの現時点までの発言は確定させる
            if (!string.IsNullOrEmpty(responseText))
            {
                AppendTalkEntry(TalkRole.Assistant, responseText, "");
            }
            responseText = "";

            // 関数呼出し情報を一時的にトーク履歴に追加する
            var entryCall = new TalkEntry
            {
                Uuid = Guid.Empty,
                Role = TalkRole.Tool,
                Text = $"[{context.Function.Name}] お待ち下さい...",
                ToolDetail = argJson,
                AttachmentId = null,
                Timestamp = new DateTimeOffset(DateTime.UtcNow).ToUnixTimeSeconds()
            };

            var entryCallGuid = fileManager.UpsertTalkHistoryToActivePersona(entryCall);
            await Broadcaster.Broadcast(new Dictionary<string, object> { { "status", "tool_update" } });

            await Task.Delay(500); // 少し待つ

            object? result;
            try
            {
                // 添付ファイルIDをリセット
                tools.lastAttachmentId = null;
                
                // 関数を実行
                result = await context.Function.InvokeAsync(context.Arguments, cancellationToken);
                var resultJson = Serializer.JsonSerialize(new Dictionary<string, object?> { { "call", context.Arguments }, { "result", result } }, false);
                MyLog.LogWrite($"関数呼び出し結果: {resultJson}");

                // 関数呼出し結果に差し替える
                var entryResult = new TalkEntry
                {
                    Uuid = entryCallGuid,
                    Role = TalkRole.Tool,
                    Text = $"[{context.Function.Name}] 成功",
                    ToolDetail = resultJson,
                    AttachmentId = tools.lastAttachmentId != null ? new List<int> { tools.lastAttachmentId.Value } : null,
                    Timestamp = new DateTimeOffset(DateTime.UtcNow).ToUnixTimeSeconds()
                };

                fileManager.UpsertTalkHistoryToActivePersona(entryResult);
                await Broadcaster.Broadcast(new Dictionary<string, object> { { "status", "tool_update" } });
                await Task.Delay(500); // 少し待つ
            }
            catch (Exception ex)
            {
                MyLog.LogWrite($"関数呼び出しエラー: {ex.Message} {ex.StackTrace}");
                var resultJson = Serializer.JsonSerialize(new Dictionary<string, object?> { { "call", context.Arguments }, { "error", ex.Message } }, false);

                // 関数呼出し結果に差し替える
                var entryResult = new TalkEntry
                {
                    Uuid = entryCallGuid,
                    Role = TalkRole.Tool,
                    Text = $"[{context.Function.Name}] 失敗しました。",
                    Reasoning = ex.Message,
                    ToolDetail = resultJson,
                    AttachmentId = null,
                    Timestamp = new DateTimeOffset(DateTime.UtcNow).ToUnixTimeSeconds()
                };

                fileManager.UpsertTalkHistoryToActivePersona(entryResult);
                await Broadcaster.Broadcast(new Dictionary<string, object> { { "status", "tool_update" } });
                await Task.Delay(500); // 少し待つ

                throw;
            }
            return result;
        }
        public List<TalkEntry> PhotoCutoff(List<TalkEntry> talks)
        {
            int cutoffMessageIndex = fileManager.generalSettings.PhotoCutoff;
            if (cutoffMessageIndex <= 0)
            {
                return talks;
            }

            // 逆順で処理し、Photocutoffより古いメッセージインデックスの添付ファイル付きメッセージから添付ファイルを削除する
            for (int i = talks.Count - 1; i >= 0; i--)
            {
                var talk = talks[i];
                if (talk.AttachmentId != null && talk.AttachmentId.Count > 0)
                {
                    // メッセージインデックスがcutoffMessageIndexより古い場合、添付ファイルを削除する
                    if (i < talks.Count - cutoffMessageIndex)
                    {
                        // 添付ファイルを削除(元を書き換えないように新しいTalkEntryを作成する)
                        talks[i] = new TalkEntry
                        {
                            Uuid = talk.Uuid,
                            Role = talk.Role,
                            Text = talk.Text,
                            Reasoning = talk.Reasoning,
                            ToolDetail = talk.ToolDetail,
                            AttachmentId = null,
                            Timestamp = talk.Timestamp
                        };
                    }
                }
            }
            return talks;
        }

        public void AppendTalkEntry(TalkRole role, string finalResponseText, string finalReasoningText)
        {
            // ロック獲得済みのLLM生成処理から呼ばれることを想定しているため、ここでの排他制御は不要
            var entry = new TalkEntry
            {
                Uuid = Guid.Empty,
                Role = role,
                Text = finalResponseText,
                Reasoning = finalReasoningText,
                ToolDetail = "",
                AttachmentId = null,
                Timestamp = new DateTimeOffset(DateTime.UtcNow).ToUnixTimeSeconds()
            };

            fileManager.UpsertTalkHistoryToActivePersona(entry);
        }
    }
}