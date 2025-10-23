using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.Logging;

namespace CllDotnet
{
    public class WebServer
    {
        List<(WebSocket socket, TaskCompletionSource<object?> tcs)> WebSocketList = new List<(WebSocket socket, TaskCompletionSource<object?> tcs)>();
        bool isRunning = false;
        CancellationToken cancellationToken;

        ConsoleMonitor consoleMonitor;

        Persona persona;

        WebApplication? app;

        readonly Dictionary<string, object> nullJsonResponse = new Dictionary<string, object>
        {
            { "error", "致命的な異常が発生しました。(必須コンポーネントがnull)" }
        };

        // context.Request.BodyをJSONパースしてDictionary<string, object>に変換するユーティリティ関数
        private async Task<Dictionary<string, JsonElement>> ParseRequestBodyAsync(string from, HttpContext context)
        {
            using (var reader = new StreamReader(context.Request.Body))
            {
                var body = await reader.ReadToEndAsync();
                var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(body, new JsonSerializerOptions
                {
                    Converters =
                    {
                        new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)
                    }
                });

                // デバッグ用に出力
                var debugDict = dict?.ToDictionary(kvp => kvp.Key, kvp => (object)kvp.Value);
                if (debugDict?.ContainsKey("LlmApiKey") == true)
                {
                    debugDict["LlmApiKey"] = "************"; // APIキーはデバッグ出力しない
                }
                var ret = Serializer.JsonSerialize(debugDict, false);
                // 200文字以上なら切り詰めて表示
                MyLog.LogWrite($"[{from}] {(ret.Length > 200 ? ret[..200] + "..." : ret)}");

                return dict ?? new Dictionary<string, JsonElement>();
            }
        }

        // Dictionary<string, object>をJSON文字列に変換するユーティリティ関数
        private string DictionaryToJson(string from, Dictionary<string, object> dict)
        {
            var ret = Serializer.JsonSerialize(dict, false);
            // 200文字以上なら切り詰めて表示
            MyLog.LogWrite($"[{from}] {(ret.Length > 200 ? ret[..200] + "..." : ret)}");
            return ret;
        }

        // 接続元がローカルホストかどうかを判定
        private bool IsLocalhost(HttpContext context)
        {
            var remoteIp = context.Connection.RemoteIpAddress;
            if (remoteIp == null)
            {
                return false;
            }

            return IPAddress.IsLoopback(remoteIp) || remoteIp.Equals(context.Connection.LocalIpAddress);
        }

        public WebServer(ConsoleMonitor _consoleMonitor, Persona _persona)
        {
            this.consoleMonitor = _consoleMonitor;
            this.persona = _persona;
        }


        public void RunSync(int port, bool localOnly, bool systemSettingsLocalOnly, CancellationToken _cancellationToken)
        {
            isRunning = true;
            this.cancellationToken = _cancellationToken;
            var builder = WebApplication.CreateBuilder();

            MyLog.LogWrite($"ポート: {port}, ローカルアクセスのみ: {localOnly}, システム設定画面ローカルアクセスのみ: {systemSettingsLocalOnly}");

            this.consoleMonitor?.UpdateInfo("ポート", port.ToString());
            this.consoleMonitor?.UpdateInfo("アクセス許可", localOnly ? "PC内のみ" : "LAN内");
            this.consoleMonitor?.UpdateInfo("設定画面許可", systemSettingsLocalOnly ? "PC内のみ" : "LAN内");

            // Kestrelサーバーの設定
            builder.WebHost.ConfigureKestrel((context, serverOptions) =>
            {
                // 指定されたポートとアドレスでリッスン
                serverOptions.Listen(localOnly ? IPAddress.Loopback : IPAddress.Any, port, listenOptions =>
                {
                    listenOptions.Protocols = HttpProtocols.Http1;
                });
            });

            // ログレベルをWarningに設定して情報ログを抑制
            builder.Logging.ClearProviders();
            builder.Logging.AddProvider(new MyLogProvider());
            builder.Logging.SetMinimumLevel(LogLevel.Warning);

            // アプリケーションのビルド
            app = builder.Build();

            // 例外を詳細にキャッチしてトレースできるようにするミドルウェア
            app.Use(async (context, next) =>
            {
                try
                {
                    await next.Invoke();
                }
                catch (Exception ex)
                {
                    this.consoleMonitor?.UpdateInfo("エラー", $"{ex.GetType().Name}: {ex.Message}");
                    MyLog.LogWrite($"{ex.Message} {ex.StackTrace}");

                    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync(DictionaryToJson("exception middleware", new Dictionary<string, object>
                    {
                        { "error", "サーバー内部エラーが発生しました。" },
                    }));
                }
            });

            // どの関数が呼ばれたかトレースするためのミドルウェア
            app.Use(async (context, next) =>
            {
                MyLog.LogWrite($"{context.Request.Method} {context.Request.Path}{context.Request.QueryString} from {context.Connection.RemoteIpAddress}");
                await next.Invoke();
            });

            // アクセスが合ったときにフックして表示に反映するミドルウェア
            app.Use(async (context, next) =>
            {
                // アクセス元IPアドレスを取得
                var ipAddress = context.Connection.RemoteIpAddress?.ToString();
                this.consoleMonitor?.UpdateInfo("最終アクセス元", ipAddress ?? "不明");
                await next.Invoke();
            });

            // WebSocketのミドルウェアを有効化
            var websocketOptions = new WebSocketOptions
            {
                KeepAliveInterval = TimeSpan.FromSeconds(15)
            };

            app.UseWebSockets(websocketOptions);

            // キャッシュ無効化ミドルウェア
            app.Use(async (context, next) =>
            {
                context.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
                context.Response.Headers["Pragma"] = "no-cache";
                context.Response.Headers["Expires"] = "0";
                context.Response.Headers["Surrogate-Control"] = "no-store";
                await next();
            });

            // ルートはindex.htmlにリダイレクト
            app.MapGet("/", async context =>
            {
                context.Response.Redirect("/index.htm");
                await Task.Delay(0);
            });

            // システム設定画面は、ローカルホスト以外からのアクセスは拒否する(設定依存)
            // (※わかりやすさのための処理であり、これをバイパスされてもPOSTでの設定変更はできないようにしている)
            app.MapGet("/system.htm", async context =>
            {
                if (systemSettingsLocalOnly && !IsLocalhost(context))
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await context.Response.WriteAsync("<html><meta charset=\"utf-8\"><h1>現在、システム設定画面ヘはPC内からのみアクセスできるように制限されています。PCで開いてください。(この制限は設定から変更できます)</h1></html>");
                    return;
                }

                // ローカルホストからのアクセスの場合は、設定画面を表示
                await context.Response.WriteAsync(File.ReadAllText("static/system.htm"));
            });

            // 静的ファイルの提供を有効化
            app.UseStaticFiles(new StaticFileOptions
            {
                // 静的ファイルのルートディレクトリを"static"フォルダに設定
                FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(
                    System.IO.Path.Combine(System.IO.Directory.GetCurrentDirectory(), "static")
                ),
                RequestPath = ""
            });

            // APIエンドポイント
            app.MapPost("/api/system/restart", async context =>
            {
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(DictionaryToJson("POST /api/system/restart", new Dictionary<string, object>
                {
                    { "status", "サーバーを再起動します。" }
                }));
                _ = Task.Run(() =>
                {
                    Thread.Sleep(1000);
                    Program.Stop();
                });
                _ = Task.Run(() =>
                {
                    Thread.Sleep(1000);
                    Stop();
                });
            });

            // APIエンドポイント
            app.MapGet("/api/setting", async context =>
            {
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(DictionaryToJson("GET /api/setting", persona.GetSettings()));
            });

            app.MapPost("/api/setting", async context =>
            {
                if(systemSettingsLocalOnly && !IsLocalhost(context))
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/setting", new Dictionary<string, object>
                    {
                        { "error", "現在、PC内からのみ設定変更できるように制限されています。PCのブラウザからアクセスしてください。(システム設定から変更できます)" }
                    }));
                    return;
                }

                context.Response.ContentType = "application/json";
                var bodyDict = await ParseRequestBodyAsync("POST /api/setting", context);
                await context.Response.WriteAsync(DictionaryToJson("POST /api/setting", persona.SetSettings(bodyDict)));
            });

            app.MapGet("/api/persona", async context =>
            {
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(DictionaryToJson("GET /api/persona", persona.GetPersonas()));
            });

            app.MapPost("/api/persona/new", async context =>
            {
                context.Response.ContentType = "application/json";
                // jsonからnameを取得
                var bodyDict = await ParseRequestBodyAsync("POST /api/persona/new", context);
                string? name = bodyDict.ContainsKey("name") ? bodyDict["name"].ToString() : null;
                if (name == null)
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/new", new Dictionary<string, object>
                    {
                        { "error", "nameパラメーターは必須です。" }
                    }));
                    return;
                }
                await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/new", persona.NewPersona(name)));
            });

            app.MapPost("/api/persona/duplicate", async context =>
            {
                context.Response.ContentType = "application/json";
                // jsonからidを取得
                var bodyDict = await ParseRequestBodyAsync("POST /api/persona/duplicate", context);
                string? id = bodyDict.ContainsKey("id") ? bodyDict["id"].ToString() : null;
                if (id == null)
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/duplicate", new Dictionary<string, object>
                    {
                        { "error", "idパラメーターは必須です。" }
                    }));
                    return;
                }
                if (!int.TryParse(id, out int idInt))
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/duplicate", new Dictionary<string, object>
                    {
                        { "error", "idパラメーターは整数である必要があります。" }
                    }));
                    return;
                }
                // jsonからnewNameを取得（無くても良い）
                string? newName = bodyDict.ContainsKey("newName") ? bodyDict["newName"].ToString() : null;
                await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/duplicate", persona.DuplicatePersona(idInt, newName)));
            });

            app.MapPost("/api/persona/remove", async context =>
            {
                context.Response.ContentType = "application/json";
                // jsonからidを取得
                var bodyDict = await ParseRequestBodyAsync("POST /api/persona/remove", context);
                string? id = bodyDict.ContainsKey("id") ? bodyDict["id"].ToString() : null;
                if (id == null)
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/remove", new Dictionary<string, object>
                    {
                        { "error", "idパラメーターは必須です。" }
                    }));
                    return;
                }
                if (!int.TryParse(id, out int idInt))
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/remove", new Dictionary<string, object>
                    {
                        { "error", "idパラメーターは整数である必要があります。" }
                    }));
                    return;
                }
                await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/remove", persona.RemovePersona(idInt)));
            });

            app.MapGet("/api/persona/active", async context =>
            {
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(DictionaryToJson("GET /api/persona/active", persona.GetActivePersona()));
            });

            app.MapPost("/api/persona/active", async context =>
            {
                context.Response.ContentType = "application/json";
                // jsonからidを取得
                var bodyDict = await ParseRequestBodyAsync("POST /api/persona/active", context);
                string? id = bodyDict.ContainsKey("id") ? bodyDict["id"].ToString() : null;
                if (id == null)
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/active", new Dictionary<string, object>
                    {
                        { "error", "idパラメーターは必須です。" }
                    }));
                    return;
                }
                if (!int.TryParse(id, out int idInt))
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/active", new Dictionary<string, object>
                    {
                        { "error", "idパラメーターは整数である必要があります。" }
                    }));
                    return;
                }
                await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/active", persona.SetActivePersona(idInt)));
            });

            app.MapGet("/api/persona/active/attachment", async context =>
            {
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(DictionaryToJson("GET /api/persona/active/attachment", persona.GetActivePersonaAttachments()));
            });

            app.MapPost("/api/persona/active/attachment", async context =>
            {
                context.Response.ContentType = "application/json";
                // ファイルアップロードの処理
                if (!context.Request.HasFormContentType)
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/active/attachment", new Dictionary<string, object>
                    {
                        { "error", "フォームデータが必要です。" }
                    }));
                    return;
                }

                var form = await context.Request.ReadFormAsync();
                var file = form.Files.GetFile("file");
                if (file == null)
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/active/attachment", new Dictionary<string, object>
                    {
                        { "error", "fileパラメーターは必須です。" }
                    }));
                    return;
                }

                using (var ms = new MemoryStream())
                {
                    await file.CopyToAsync(ms);
                    var data = ms.ToArray();
                    await context.Response.WriteAsync(DictionaryToJson("POST /api/persona/active/attachment", persona.UploadActivePersonaAttachment(file.FileName, data)));
                }
            });

            app.MapGet("/api/persona/active/attachment/{id}", async context =>
            {
                if (!int.TryParse(context.Request.RouteValues["id"]?.ToString(), out int idInt))
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                    await context.Response.WriteAsync(DictionaryToJson($"GET /api/persona/active/attachment/{idInt}", new Dictionary<string, object>
                    {
                        { "error", "idパラメーターは整数である必要があります。" }
                    }));
                    return;
                }

                var file = persona.GetActivePersonaAttachmentById(idInt);
                if (file == null)
                {
                    context.Response.StatusCode = StatusCodes.Status404NotFound;
                    await context.Response.WriteAsync(DictionaryToJson($"GET /api/persona/active/attachment/{idInt}", new Dictionary<string, object>
                    {
                        { "error", "File not found" }
                    }));
                    return;
                }

                // 拡張子からContent-Typeを設定
                var extension = Path.GetExtension(file?.filename!).ToLower();
                string contentType = extension switch
                {
                    ".txt" => "text/plain",
                    ".webp" => "image/webp",
                    ".gif" => "image/gif",
                    ".jpg" => "image/jpeg",
                    ".png" => "image/png",
                    _ => "application/octet-stream",
                };

                context.Response.ContentType = contentType;
                await context.Response.Body.WriteAsync(file?.data!, 0, (int)file?.data!.Length!);
            });

            app.MapGet("/api/persona/active/{file}", async context =>
            {
                var file = context.Request.RouteValues["file"]?.ToString() ?? "";
                var data = persona.GetActivePersonaFile(file);
                if (data == null || data.Length == 0)
                {
                    context.Response.StatusCode = StatusCodes.Status404NotFound;
                    await context.Response.WriteAsync(DictionaryToJson($"GET /api/persona/active/{file}", new Dictionary<string, object>
                    {
                        { "error", "File not found" }
                    }));
                    return;
                }

                // 拡張子からContent-Typeを設定
                var extension = Path.GetExtension(context.Request.RouteValues["file"]?.ToString() ?? "").ToLower();
                string contentType = extension switch
                {
                    ".txt" => "text/plain",
                    ".webp" => "image/webp",
                    ".gif" => "image/gif",
                    ".jpg" => "image/jpeg",
                    ".png" => "image/png",
                    _ => "application/octet-stream",
                };

                context.Response.ContentType = contentType;
                await context.Response.Body.WriteAsync(data, 0, data.Length);
            });

            app.MapPost("/api/persona/active/{file}", async context =>
            {
                var file = context.Request.RouteValues["file"]?.ToString() ?? "";
                using (var ms = new MemoryStream())
                {
                    await context.Request.Body.CopyToAsync(ms);
                    var data = ms.ToArray();
                    await context.Response.WriteAsync(DictionaryToJson($"POST /api/persona/active/{file}", persona.UploadActivePersonaFile(file, data)));
                }
            });

            app.MapGet("/api/persona/active/message", async context =>
            {
                context.Response.ContentType = "application/json";
                // クエリパラメーターからindexとcountを取得
                int index = 0;
                int count = 50;
                if (context.Request.Query.ContainsKey("index"))
                {
                    int.TryParse(context.Request.Query["index"], out index);
                }
                if (context.Request.Query.ContainsKey("count"))
                {
                    int.TryParse(context.Request.Query["count"], out count);
                }
                await context.Response.WriteAsync(DictionaryToJson($"GET /api/persona/active/message?index={index}&count={count}", await persona.GetActivePersonaMessages(index, count, cancellationToken)));
            });

            app.MapPost("/api/persona/active/message", async context =>
            {
                context.Response.ContentType = "application/json";
                var bodyDict = await ParseRequestBodyAsync($"POST /api/persona/active/message", context);
                await context.Response.WriteAsync(DictionaryToJson($"POST /api/persona/active/message", await persona.UpsertActivePersonaMessage(bodyDict, cancellationToken)));
            });

            app.MapPost("/api/persona/active/cancel", async context =>
            {
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(DictionaryToJson($"POST /api/persona/active/cancel", persona.CancelActivePersonaMessageGeneration()));
            });

            app.MapGet("/api/persona/active/setting", async context =>
            {
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(DictionaryToJson($"GET /api/persona/active/setting", persona.GetActivePersonaSettings()));
            });

            app.MapPost("/api/persona/active/setting", async context =>
            {
                context.Response.ContentType = "application/json";
                var bodyDict = await ParseRequestBodyAsync($"POST /api/persona/active/setting", context);
                await context.Response.WriteAsync(DictionaryToJson($"POST /api/persona/active/setting", persona.SetActivePersonaSettings(bodyDict)));
            });

            app.MapGet("/api/persona/active/memory", async context =>
            {
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(DictionaryToJson($"GET /api/persona/active/memory", persona.GetActivePersonaMemory()));
            });

            // WebSocket接続のハンドリング
            app.Map("/ws", async context =>
            {
                if (context.WebSockets.IsWebSocketRequest)
                {
                    using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
                    var socketFinishedTcs = new TaskCompletionSource<object?>(cancellationToken);

                    // もし16以上のソケットがある場合は古いものから切断
                    while (WebSocketList.Count >= 16)
                    {
                        Program.cts.Token.ThrowIfCancellationRequested();

                        var oldestSocket = WebSocketList.First();
                        oldestSocket.tcs.SetResult(null);
                        WebSocketList.Remove(oldestSocket);
                    }

                    // 新しいソケットをリストに追加
                    WebSocketList.Add((webSocket, socketFinishedTcs));

                    // ソケットが閉じられるまで待機(ソケットごとにTaskで管理されるためここでawaitしても他のソケットには影響しない)
                    await socketFinishedTcs.Task;
                }
                else
                {
                    context.Response.StatusCode = StatusCodes.Status400BadRequest;
                }
            });

            // 1秒おきにpingを送るタスク
            Task.Run(async () =>
            {
                while (isRunning && !cancellationToken.IsCancellationRequested)
                {
                    try
                    {
                        await Task.Delay(1000);
                        Program.cts.Token.ThrowIfCancellationRequested();
                        await Broadcast(new Dictionary<string, object> { { "ping", true } });
                    }
                    catch (OperationCanceledException)
                    {
                        // キャンセル時の例外は無視
                    }
                    catch (Exception ex)
                    {
                        MyLog.LogWrite($"Ping送信中にエラーが発生: {ex.Message} {ex.StackTrace}");
                    }
                }
            });

            // アプリケーションの起動
            app.Run();
            isRunning = false;
        }

        public void Stop()
        {
            MyLog.LogWrite("Webサーバーを停止しています...");
            isRunning = false;
            Task.Run(async () =>
            {
                // 全てのWebSocket接続を閉じる
                foreach (var wsTuple in WebSocketList)
                {
                    var webSocket = wsTuple.Item1;
                    try
                    {
                        _ = webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Server is stopping", CancellationToken.None);
                    }
                    catch
                    {
                        // クローズに失敗しても無視
                    }

                    var tcs = wsTuple.Item2;
                    // サーバーの待機タスクを完了させる
                    tcs.SetResult(null);
                }

                await app!.StopAsync();
            }).Wait();
            MyLog.LogWrite("OK");
        }

        // 全ての接続されたWebSocketにメッセージを送信
        public async Task Broadcast(Dictionary<string, object> dict)
        {
            var closedSockets = new List<(WebSocket socket, TaskCompletionSource<object?> tcs)>();

            var message = Serializer.JsonSerialize(dict, false);

            // ソケットを走査
            foreach (var wsTuple in WebSocketList)
            {
                Program.cts.Token.ThrowIfCancellationRequested();
                var webSocket = wsTuple.socket;

                // ソケットが開いている場合はメッセージを送信
                if (webSocket.State != WebSocketState.Open && webSocket.State != WebSocketState.Connecting)
                {
                    closedSockets.Add(wsTuple);
                    continue;
                }

                var messageBuffer = System.Text.Encoding.UTF8.GetBytes(message);
                var segment = new ArraySegment<byte>(messageBuffer);

                try
                {
                    await webSocket.SendAsync(segment, WebSocketMessageType.Text, true, cancellationToken);
                }
                catch
                {
                    // 送信に失敗した場合はソケットをクローズリストに追加
                    closedSockets.Add(wsTuple);
                }
            }

            // クローズされたソケットをリストから削除
            foreach (var closedWs in closedSockets)
            {
                var tcs = closedWs.Item2;
                // サーバーの待機タスクを完了させる
                tcs.SetResult(null);
                // リストから削除
                WebSocketList.Remove(closedWs);
            }
        }
    }
}