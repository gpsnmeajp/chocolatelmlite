using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;
using System.ComponentModel;
using System.Linq;
using Microsoft.Extensions.AI;
using ModelContextProtocol.Client;
using Jint;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;

namespace CllDotnet
{
    public class Tools : IAsyncDisposable
    {
        private readonly FileManager _fileManager;
        private readonly ConsoleMonitor _consoleMonitor;
        private List<McpClient> _mcpClients = new List<McpClient>();
        private ImageGenerater _imageGenerater;
        public int? lastAttachmentId = null;
        public bool isImageGenerated = false; // 連続作成制限
        List<AITool> _mcpTools = new List<AITool>();

        public async ValueTask DisposeAsync()
        {
            foreach (var client in _mcpClients)
            {
                await client.DisposeAsync();
            }
        }

        public Tools(ImageGenerater imageGenerater, FileManager fileManager, ConsoleMonitor consoleMonitor)
        {
            _fileManager = fileManager;
            _consoleMonitor = consoleMonitor;
            _imageGenerater = imageGenerater;
        }

        public async Task InitToolsAsync()
        {
            // MCPツールの有効化設定がされている場合に初期化を開始
            if (_fileManager.generalSettings.EnableMcpTools)
            {
                // MCPツールの初期化を非同期で実行
                try
                {
                    await InitMcpToolsAsync();

                    // MCPツールを追加
                    foreach (var client in _mcpClients)
                    {
                        // MCPクライアントから利用可能なツールを取得して追加
                        var mcpTools = await client.ListToolsAsync();
                        foreach (var tool in mcpTools)
                        {
                            lock (_mcpTools)
                            {
                                _mcpTools.Add(tool);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    MyLog.LogWrite($"MCPツールの初期化に失敗しました: {ex.Message} {ex.StackTrace}");
                }
            }
        }

        // 利用可能なツールの一覧を取得するメソッド
        // 全体設定に応じて、利用可能なツールを制御・限定する処理を兼ねている
        public async Task<IList<AITool>> GetAvailableTools()
        {
            await Task.Delay(0);
            List<AITool> tools = new List<AITool>();
            var generalSettings = _fileManager.generalSettings;

            if (generalSettings.EnableHowto)
            {
                tools.Add(AIFunctionFactory.Create(Howto));
            }

            if (generalSettings.EnableMemory)
            {
                tools.Add(AIFunctionFactory.Create(UpdatePersonaMemory));
            }

            if (generalSettings.EnableJavascript)
            {
                tools.Add(AIFunctionFactory.Create(Eval));
            }

            if (generalSettings.EnableProject)
            {
                tools.Add(AIFunctionFactory.Create(ReadProjectFile));
                tools.Add(AIFunctionFactory.Create(WriteProjectFile));
            }

            if (generalSettings.EnableImageGeneration)
            {
                tools.Add(AIFunctionFactory.Create(GenerateImage));
            }

            if (generalSettings.EnableOllamaWebExtension)
            {
                tools.Add(AIFunctionFactory.Create(OllamaWebSearch));
                tools.Add(AIFunctionFactory.Create(OllamaWebFetch));
            }

            if (generalSettings.EnableMcpTools)
            {
                lock (_mcpTools)
                {
                    tools.AddRange(_mcpTools);
                }
            }

            return tools;
        }


        [Description("何ができるの？このアプリって何？")]
        async Task<string> Howto()
        {
            await Task.Delay(0);
            return @"Chocolate LM Liteは、セルフホスト型のAIチャットアプリケーションです。
主な特徴は以下の通りです：
- APIサービスやローカルLLMを設定し、自由な対話が可能
- シンプルな画面で初心者に優しい設計
- 複数のペルソナ(キャラクター)を作成・管理可能(それぞれにシステムプロンプト・モデル・メモリを設定可能)
- タイムスタンプ機能で、時間を考慮した対話が可能
- 自動コンテキストカットオフ機能により、最大長制限なく対話を継続できます
- 仮想スクロール機能で、大量の対話履歴も快適に閲覧可能
- 会話統計機能で、自分がどれだけ会話したか把握可能
- 短時間に大量の会話をした場合、休憩を促すメッセージを表示する機能もあります
- 古い履歴や画像はトークン数節約のため自動的に送信対象から外されます
- メモリ機能で、会話が長引いても重要な情報を保持可能
- Javascriptサンドボックス実行ツールで、正確な計算などが可能
- プロジェクトフォルダ管理機能で、資料を読んだりプログラムを書いたりできます。
- Webhook機能で、AIの発言をDiscordなど外部サービスに転送可能
- タイマーで自発的に発言する機能を搭載
- マルチモーダルLLMによる画像生成機能を備えます
- Model Context Protocolによる外部ツール拡張機能を備え、AIの機能を柔軟に拡張可能
- 定期的な自動アップデートチェック機能を搭載
ぜひChocolate LM Liteをお楽しみください！

注意
- ご利用の際は、各APIサービスの利用規約を遵守してください。
- 生成されたコンテンツの責任はユーザーにあります。
- 外部ツール呼び出しの際に承認や確認は行いません。
- 標準ツールは安全性を考慮していますが、MCPツールなど外部ツールの利用には注意してください。
- 各種ツールはオンオフおよび各種制限調整が可能です。必要に応じて調整してください。(既定では無効になっている機能もあります)

この内容を、あなたのキャラクター性に合わせて、適切にユーザーに説明してください。
";
        }

        [Description("サンドボックス内でJavascriptコードを実行します")]
        async Task<string> Eval(
            [Description("実行するJavascriptコード")] string code
        )
        {
            await Task.Delay(0);
            string consolelog = "";
            var console = new
            {
                log = new Action<object>(msg =>
                {
                    if (msg == null)
                    {
                        msg = "null";
                    }
                    MyLog.LogWrite($"[Jint.Engine] {msg}");
                    consolelog += msg.ToString() + "\n";
                })
            };
            var engine = new Jint.Engine(options =>
            {
                options.TimeZone = _fileManager.GetTimeZoneInfo();
                options.LimitMemory(4_000_000);
                options.TimeoutInterval(TimeSpan.FromSeconds(15));
                options.MaxStatements(10000);
                options.LimitRecursion(64);
                options.CancellationToken(cancellationToken: Program.cts.Token);
            })
                .SetValue("console", console);

            var ret = engine.Evaluate(code).ToString();

            // 結果とコンソールログを組み合わせて返す(どちらか一方のみの場合はシンプルに返す)
            if (string.IsNullOrEmpty(consolelog))
            {
                return ret;
            }
            else if (string.IsNullOrEmpty(ret) || ret == "undefined" || ret == "null")
            {
                return consolelog;
            }
            else
            {
                return Serializer.JsonSerialize(
                    new Dictionary<string, string>
                    {
                        { "result", ret },
                        { "console", consolelog }
                    }
                );
            }
        }

        [Description("覚えておくべき情報を保存するの使います")]
        async Task<string> UpdatePersonaMemory(
            [Description("メモリID(0:新規)")] int id,
            [Description("新しい内容(空:削除)")] string newContent)
        {
            MyLog.LogWrite($"メモリ更新ツール呼び出し: id={id}, newContent='{newContent}'");
            if (newContent != null && newContent.Length > 500)
            {
                return "エラー: 内容が500文字を超えているため追加できませんでした。利用可能な場合は、プロジェクトへの保存を検討してください。";
            }

            if (string.IsNullOrWhiteSpace(newContent))
            {
                return await _fileManager.WithMemoryLock(async () =>
                {
                    await Task.Delay(0);
                    return _fileManager.RemoveActivePersonaMemory(id);
                }, cancellationToken: Program.cts.Token) ? "メモリを削除しました。" : "メモリの削除に失敗しました。";
            }
            else
            {
                return await _fileManager.WithMemoryLock(async () =>
                {
                    await Task.Delay(0);
                    return _fileManager.UpsertActivePersonaMemory(id, newContent);
                }, cancellationToken: Program.cts.Token) ? "メモリを更新しました。" : "メモリの更新に失敗しました。";
            }
        }

        [Description("プロジェクトフォルダ内のファイル内容を取得")]
        async Task<string> ReadProjectFile(
            [Description("取得するファイル名")] string fileName
        )
        {
            await Task.Delay(0);
            var fileContent = _fileManager.GetProjectFileContentFromActivePersona(fileName);
            return fileContent;
        }

        [Description("プロジェクトフォルダ内にファイルとして保存")]
        async Task<string> WriteProjectFile(
            [Description("保存するファイル名")] string fileName,
            [Description("保存する内容")] string content
        )
        {
            await Task.Delay(0);

            // 危険な拡張子はtxtに変換して保存する
            if (DangerousChecker.IsDangerousFileName(fileName))
            {
                fileName = Path.ChangeExtension(fileName, ".txt");
            }

            var result = _fileManager.SaveProjectFileContentToActivePersona(fileName, content);
            return result ? $"ファイルを保存しました: {fileName}" : "ファイルの保存に失敗しました。";
        }

        [Description("マルチモーダル言語モデルに画像の生成を依頼")]
        async Task<string> GenerateImage(
            [Description("生成する画像の説明")] string prompt,
            [Description("ユーザーからの要求かどうか")] bool isRequestByUser = false
        )
        {
            await Task.Delay(0);
            if (!isRequestByUser)
            {
                var ret = "画像生成は高価なためユーザーからの明示的な要求時のみ実行可能です。";
                MyLog.LogWrite(ret);
                throw new InvalidOperationException(ret);
            }

            if (isImageGenerated)
            {
                var ret = "画像は既に生成されています。1回のユーザー要求に対して2回以上連続して画像を生成することはできません。";
                MyLog.LogWrite(ret);
                throw new InvalidOperationException(ret);
            }

            var (textResponse, id) = await _imageGenerater.GenerateImage(prompt);

            if (id.HasValue)
            {
                // サイドチャネルとして添付ファイルIDを保存
                lastAttachmentId = id.Value;
                isImageGenerated = true;
            }

            return textResponse;
        }

        [Description("Ollama Web Search APIを使ってWeb検索を行います")]
        async Task<string> OllamaWebSearch(
            [Description("検索クエリ")] string query,
            [Description("取得する最大件数(1-10)")] int maxResults = 5
        )
        {
            await Task.Delay(0);
            if (string.IsNullOrWhiteSpace(query))
            {
                throw new InvalidOperationException("検索クエリを入力してください。");
            }

            maxResults = Math.Clamp(maxResults, 1, 10);

            var payload = new
            {
                query = query.Trim(),
                max_results = maxResults
            };

            return await CallOllamaWebExtensionAsync("web_search", payload);
        }

        [Description("Ollama Web Fetch APIを使って指定URLの内容を取得します")]
        async Task<string> OllamaWebFetch(
            [Description("取得するURL")] string url
        )
        {
            await Task.Delay(0);
            if (string.IsNullOrWhiteSpace(url))
            {
                throw new InvalidOperationException("URLを入力してください。");
            }

            var payload = new
            {
                url = url.Trim()
            };

            return await CallOllamaWebExtensionAsync("web_fetch", payload);
        }

        private class OllamaWebSearchResponse
        {
            public List<OllamaWebSearchResult> Results { get; set; } = new();
        }

        private class OllamaWebSearchResult
        {
            public string? Title { get; set; }
            public string? Url { get; set; }
            public string? Content { get; set; }
        }

        private class OllamaWebFetchResponse
        {
            public string? Title { get; set; }
            public string? Content { get; set; }
            public List<string> Links { get; set; } = new();
        }

        private async Task<string> CallOllamaWebExtensionAsync(string path, object payload)
        {
            var settings = _fileManager.generalSettings;
            if (!settings.EnableOllamaWebExtension)
            {
                throw new InvalidOperationException("Ollama Web拡張は無効化されています。");
            }

            if (string.IsNullOrWhiteSpace(settings.OllamaWebExtensionEndpointUrl))
            {
                throw new InvalidOperationException("Ollama Web拡張のBase URLが設定されていません。");
            }

            if (string.IsNullOrWhiteSpace(settings.OllamaWebExtensionApiKey))
            {
                throw new InvalidOperationException("Ollama Web拡張のAPIキーが設定されていません。");
            }

            var baseUrl = settings.OllamaWebExtensionEndpointUrl.Trim();
            if (!baseUrl.EndsWith("/"))
            {
                baseUrl += "/";
            }

            var requestUri = baseUrl + path.TrimStart('/');
            var requestBody = JsonSerializer.Serialize(payload);

            if (settings.DebugMode)
            {
                MyLog.DebugFileWrite($"ollama_{path}_request.json", requestBody);
            }

            using var httpClient = new HttpClient();
            httpClient.Timeout = TimeSpan.FromSeconds(settings.TimeoutSeconds);

            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, requestUri);
            httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.OllamaWebExtensionApiKey);
            httpRequest.Content = new StringContent(requestBody, Encoding.UTF8, "application/json");

            using var httpResponse = await httpClient.SendAsync(httpRequest, Program.cts.Token);
            var responseContent = await httpResponse.Content.ReadAsStringAsync();

            if (settings.DebugMode)
            {
                MyLog.DebugFileWrite($"ollama_{path}_response.json", responseContent);
            }

            if (!httpResponse.IsSuccessStatusCode)
            {
                if (httpResponse.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                {
                    var message = "Ollama Web拡張のAPI使用制限に達しました。しばらく待ってから再度お試しください。(Too Many Requests)";
                    MyLog.LogWrite(message);
                    return message;
                }
                else if (httpResponse.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    var message = "Ollama Web拡張のAPIキーが無効です。設定を確認してください。";
                    MyLog.LogWrite(message);
                    throw new InvalidOperationException(message);
                }
                else
                {
                    var message = $"Ollama Web拡張呼び出しに失敗しました。(HTTP {(int)httpResponse.StatusCode})";
                    MyLog.LogWrite($"{message} {responseContent}");
                    throw new InvalidOperationException($"{message} : {responseContent}");
                }
            }

            return await SummarizeOllamaWebExtensionResponseAsync(path, responseContent, baseUrl);
        }

        private async Task<string> SummarizeOllamaWebExtensionResponseAsync(string path, string rawResponse, string baseUrl)
        {
            // モデル未設定の場合は生レスポンスを返す
            var settings = _fileManager.generalSettings;
            if (string.IsNullOrWhiteSpace(settings.OllamaWebExtensionSummarizeModelName))
            {
                return rawResponse;
            }

            try
            {
                var options = new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                };

                if (path.Equals("web_search", StringComparison.OrdinalIgnoreCase))
                {
                    var parsed = JsonSerializer.Deserialize<OllamaWebSearchResponse>(rawResponse, options);
                    if (parsed?.Results == null || parsed.Results.Count == 0)
                    {
                        return rawResponse;
                    }

                    var source = BuildSearchSourceText(parsed.Results);
                    if (settings.DebugMode)
                    {
                        MyLog.DebugFileWrite($"ollama_web_search_source.json", source);
                    }
                    //MyLog.LogWrite($"Ollama Web検索結果の要約を開始: {source}");
                    var prompt = BuildSummaryPrompt("Web search results", source);
                    var summarized = await CallOllamaCloudChatAsync(baseUrl, settings, prompt);
                    MyLog.LogWrite($"要約結果: {summarized}");
                    return summarized ?? rawResponse;
                }

                if (path.Equals("web_fetch", StringComparison.OrdinalIgnoreCase))
                {
                    var parsed = JsonSerializer.Deserialize<OllamaWebFetchResponse>(rawResponse, options);
                    if (parsed == null || string.IsNullOrWhiteSpace(parsed.Content))
                    {
                        return rawResponse;
                    }

                    var source = BuildFetchSourceText(parsed);
                    if (settings.DebugMode)
                    {
                        MyLog.DebugFileWrite($"ollama_web_fetch_source.json", source);
                    }

                    //MyLog.LogWrite($"Ollama Web拡張結果の要約を開始: {source}");
                    var prompt = BuildSummaryPrompt("Web fetch results", source);
                    var summarized = await CallOllamaCloudChatAsync(baseUrl, settings, prompt);
                    MyLog.LogWrite($"要約結果: {summarized}");
                    return summarized ?? rawResponse;
                }
            }
            catch (Exception ex)
            {
                MyLog.LogWrite($"Ollama Web拡張結果の要約に失敗しました: {ex.Message} {ex.StackTrace}");
                return rawResponse;
            }

            // 未対応パスはそのまま返す
            return rawResponse;
        }

        private string BuildSearchSourceText(IReadOnlyList<OllamaWebSearchResult> results)
        {
            var sb = new StringBuilder();
            for (int i = 0; i < results.Count; i++)
            {
                var r = results[i];
                var title = string.IsNullOrWhiteSpace(r.Title) ? "(no title)" : r.Title.Trim();
                var url = string.IsNullOrWhiteSpace(r.Url) ? "" : r.Url.Trim();
                var content = r.Content;
                sb.AppendLine($"[{i + 1}] {title}");
                if (!string.IsNullOrWhiteSpace(url))
                {
                    sb.AppendLine($"URL: {url}");
                }
                if (!string.IsNullOrWhiteSpace(content))
                {
                    sb.AppendLine($"<content>{content}</content>");
                }
                sb.AppendLine();
            }
            return sb.ToString();
        }

        private string BuildFetchSourceText(OllamaWebFetchResponse response)
        {
            var sb = new StringBuilder();
            if (!string.IsNullOrWhiteSpace(response.Title))
            {
                sb.AppendLine($"Title: {response.Title.Trim()}");
            }

            if (response.Links != null && response.Links.Count > 0)
            {
                var firstLinks = response.Links.ToList();
                sb.AppendLine("Links:");
                foreach (var link in firstLinks)
                {
                    sb.AppendLine($"- {link}");
                }
                sb.AppendLine();
            }

            if (!string.IsNullOrWhiteSpace(response.Content))
            {
                sb.AppendLine($"<content>{response.Content}</content>");
            }

            return sb.ToString();
        }

        private string BuildSummaryPrompt(string title, string sourceText)
        {
            var sb = new StringBuilder();
            sb.AppendLine($"Summarize {title}.");
            sb.AppendLine("- Keep it concise and under 2000 characters.");
            sb.AppendLine("- Focus on factual points.");
            sb.AppendLine("- Output as YAML (title, content, url).");
            sb.AppendLine("- Preserve the original language; if Japanese is included, summarize in Japanese.");
            sb.AppendLine();
            sb.AppendLine(TrimToLimit(sourceText, 128*1000)); // 128k文字まで
            sb.AppendLine("<reminder>Output as YAML (title, content, url).</reminder>");
            return sb.ToString();
        }

        private async Task<string?> CallOllamaCloudChatAsync(string baseUrl, YamlGeneral settings, string userContent)
        {
            if (string.IsNullOrWhiteSpace(userContent))
            {
                return null;
            }

            var chatUrl = baseUrl + "chat";
            var payload = new
            {
                model = settings.OllamaWebExtensionSummarizeModelName.Trim(),
                messages = new List<object>
                {
                    new { role = "system", content = "You summarize the provided web data. Keep answers under 2000 characters." },
                    new { role = "user", content = userContent }
                },
                stream = false
            };

            var requestBody = JsonSerializer.Serialize(payload);

            for (int attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    using var httpClient = new HttpClient();
                    httpClient.Timeout = TimeSpan.FromSeconds(settings.TimeoutSeconds);

                    using var httpRequest = new HttpRequestMessage(HttpMethod.Post, chatUrl);
                    httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.OllamaWebExtensionApiKey);
                    httpRequest.Content = new StringContent(requestBody, Encoding.UTF8, "application/json");

                    if (settings.DebugMode)
                    {
                        MyLog.DebugFileWrite($"ollama_summarize_request.json", requestBody);
                    }

                    using var httpResponse = await httpClient.SendAsync(httpRequest, Program.cts.Token);
                    var responseContent = await httpResponse.Content.ReadAsStringAsync();

                    if (settings.DebugMode)
                    {
                        MyLog.DebugFileWrite($"ollama_summarize_response.json", responseContent);
                    }

                    if (!httpResponse.IsSuccessStatusCode)
                    {
                        MyLog.LogWrite($"Ollama Cloudによる要約呼び出しに失敗しました。(HTTP {(int)httpResponse.StatusCode}) {responseContent} (attempt {attempt}/3)");
                        if (attempt < 3)
                        {
                            continue;
                        }
                        throw new InvalidOperationException($"Ollama Cloud要約呼び出しに失敗しました。(HTTP {(int)httpResponse.StatusCode}) : {responseContent}");
                    }

                    try
                    {
                        using var doc = JsonDocument.Parse(responseContent);
                        if (doc.RootElement.TryGetProperty("message", out var messageElement) &&
                            messageElement.TryGetProperty("content", out var contentElement))
                        {
                            var summary = contentElement.GetString() ?? string.Empty;
                            return TrimToLimit(summary, 4000);
                        }

                        if (doc.RootElement.TryGetProperty("content", out var rootContentElement))
                        {
                            var summary = rootContentElement.GetString() ?? string.Empty;
                            return TrimToLimit(summary, 4000);
                        }
                    }
                    catch (Exception ex)
                    {
                        MyLog.LogWrite($"Ollama Cloudレスポンスの解析に失敗しました: {ex.Message} (attempt {attempt}/3)");
                        if (attempt < 3)
                        {
                            continue;
                        }
                        throw new InvalidOperationException("Ollama Cloudレスポンスの解析に失敗しました。", ex);
                    }

                    // 正常終了したが想定したフィールドがなかった
                    if (attempt < 3)
                    {
                        MyLog.LogWrite($"Ollama Cloudレスポンスに要約が見つかりませんでした (attempt {attempt}/3)");
                        continue;
                    }
                    throw new InvalidOperationException("Ollama Cloudレスポンスに要約が見つかりませんでした。");
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    MyLog.LogWrite($"Ollama Cloud要約呼び出し中に例外が発生しました: {ex.Message} (attempt {attempt}/3)");
                    if (attempt < 3)
                    {
                        continue;
                    }
                    throw new Exception("Ollama Cloud要約呼び出し中に例外が発生しました。", ex);
                }
            }
            return null;
        }

        private string TrimToLimit(string? value, int maxLength)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }
            if (value.Length <= maxLength)
            {
                return value;
            }
            return value.Substring(0, maxLength);
        }

        private class McpConfig
        {
            public Dictionary<string, McpServerConfig> McpServers { get; set; } = new Dictionary<string, McpServerConfig>();
        }

        private class McpServerConfig
        {
            public string? Command { get; set; }
            public List<string>? Args { get; set; }
            public Dictionary<string, string?>? Env { get; set; }
            public string? WorkingDirectory { get; set; }
            public string? Url { get; set; }
            public Dictionary<string, string>? Headers { get; set; }
        }

        public async Task InitMcpToolsAsync()
        {
            var json = _fileManager.GetMcpJson();
            if (string.IsNullOrWhiteSpace(json))
            {
                // 空のmcp.jsonを作る
                var emptyConfig = new McpConfig();
                var emptyJson = JsonSerializer.Serialize(emptyConfig, new JsonSerializerOptions { WriteIndented = true });
                _fileManager.SaveMcpJson(emptyJson);
                MyLog.LogWrite("空のmcp.jsonファイルを作成しました。");
                return;
            }

            var config = JsonSerializer.Deserialize<McpConfig>(json, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            if (config == null || config.McpServers.Count == 0)
            {
                MyLog.LogWrite("mcp.jsonにMCPサーバーの設定が見つかりません。");
                return;
            }

            _consoleMonitor.UpdateInfo("MCP", "MCPツールを初期化中...(時間がかかることがあります)");

            // 各MCPサーバーの設定に基づいてクライアントを初期化
            foreach (var kvp in config.McpServers)
            {
                McpClient client;
                var serverName = kvp.Key;
                var serverConfig = kvp.Value;

                if (!string.IsNullOrEmpty(serverConfig.Command))
                {
                    // ローカルコマンドベースのMCPサーバー
                    MyLog.LogWrite($"MCPサーバーを起動中(Stdio): {serverName} コマンド={serverConfig.Command}");
                    var clientTransport = new StdioClientTransport(new StdioClientTransportOptions
                    {
                        Name = serverName,
                        Command = serverConfig.Command,
                        Arguments = serverConfig.Args ?? new List<string>(),
                        WorkingDirectory = serverConfig.WorkingDirectory,
                        EnvironmentVariables = serverConfig.Env ?? new Dictionary<string, string?>(),
                        StandardErrorLines = (line) =>
                        {
                            MyLog.LogWrite($"[MCP:{serverName} STDERR] {line}");
                        }
                    }, LoggerFactory.Create(builder => builder.AddProvider(new MyLogProvider())));

                    client = await McpClient.CreateAsync(clientTransport);
                }
                else if (!string.IsNullOrEmpty(serverConfig.Url))
                {
                    // HTTPベースのMCPサーバー
                    MyLog.LogWrite($"MCPサーバーに接続中(HTTP): {serverName} URL={serverConfig.Url}");
                    var clientTransport = new HttpClientTransport(new HttpClientTransportOptions
                    {
                        Name = serverName,
                        Endpoint = new Uri(serverConfig.Url),
                        AdditionalHeaders = serverConfig.Headers ?? new Dictionary<string, string>(),
                    }, LoggerFactory.Create(builder => builder.AddProvider(new MyLogProvider())));

                    client = await McpClient.CreateAsync(clientTransport);
                }
                else
                {
                    MyLog.LogWrite($"MCPサーバーの設定が不正です: {serverName}");
                    continue;
                }

                _mcpClients.Add(client);

                foreach (var tool in await client.ListToolsAsync())
                {
                    MyLog.LogWrite($"MCPツール: {tool.Name} ({tool.Description})");
                }

                _consoleMonitor.UpdateInfo("MCP", "接続したMCPサーバーの数: " + _mcpClients.Count);
            }
        }
    }
}