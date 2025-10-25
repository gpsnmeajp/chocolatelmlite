using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;
using System.ComponentModel;
using Microsoft.Extensions.AI;
using ModelContextProtocol.Client;
using Jint;
using System.Text.Json;
using Microsoft.Extensions.Logging;

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

            if (generalSettings.EnableMcpTools)
            {
                lock (_mcpTools)
                {
                    tools.AddRange(_mcpTools);
                }
            }

            return tools;
        }


        [Description("本アプリケーションについての説明文を取得")]
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

        [Description("任意の短文が保存できるメモリの追加・更新(500文字以内)")]
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