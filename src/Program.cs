using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

/*
dotnet publish -c Release --self-contained true -r win-x64

※-p:PublishSingleFile=Trueをつけると、単一ファイルになるが、誤検知されるようになるのでつけない。

dotnet tool install --global nuget-license
nuget-license -i cll-dotnet.sln -o Markdown > 3rd_license.md
*/

namespace CllDotnet
{
    class Program
    {
        static bool exit = false;
        public static CancellationTokenSource cts = new CancellationTokenSource();
        static Action? cancelHandler;
        static Mutex? mutex;
        static void Main()
        {
            MyLog.LogWrite("Chocolate LM Lite サーバーコンソール");
            MyLog.LogWrite("準備中...");
            Console.CancelKeyPress += Canceler;

            // カレントフォルダ
            MyLog.LogWrite($"カレントフォルダ: {Directory.GetCurrentDirectory()}");

            // カレントフォルダ直下にstaticフォルダが有るかチェック。なければ例外。
            string staticDir = Path.Combine(Directory.GetCurrentDirectory(), "static");
            if (!Directory.Exists(staticDir))
            {
                MyLog.LogWrite($"staticフォルダが存在しません: {staticDir}");
                return;
            }

            // カレントフォルダ直下にdataフォルダが有るかチェック。なければ作成。
            string dataDir = Path.Combine(Directory.GetCurrentDirectory(), "data"); ;
            if (!Directory.Exists(dataDir))
            {
                MyLog.LogWrite($"dataフォルダが存在しないため作成します: {dataDir}");
                Directory.CreateDirectory(dataDir);
            }

            // カレントフォルダ直下にlogsフォルダが有るかチェック。なければ作成。
            string logsDir = Path.Combine(Directory.GetCurrentDirectory(), "logs");
            if (!Directory.Exists(logsDir))
            {
                MyLog.LogWrite($"logsフォルダが存在しないため作成します: {logsDir}");
                Directory.CreateDirectory(logsDir);
            }

            MyLog.LogWrite("フォルダチェック完了");

            while (!exit)
            {
                // ファイルマネージャーの初期化
                MyLog.LogWrite("ファイルマネージャーの初期化");
                FileManager fileManager = new FileManager();

                bool anotherInstanceRunning = false;
                try
                {
                    try
                    {
                        mutex = new Mutex(false, $"Global\\ChocolateLMLiteMutex{fileManager.generalSettings.HttpPort}", out bool createdNew);
                        if (!createdNew)
                        {
                            // 既に他のインスタンスが起動している
                            anotherInstanceRunning = true;
                        }
                        // ロックを獲得できた場合はそのまま保持し、終了時に解放されるようにする
                        mutex?.WaitOne(0, false);
                    }
                    catch (UnauthorizedAccessException)
                    {
                        // アクセス拒否された場合も、他のインスタンスが起動しているとみなす
                        anotherInstanceRunning = true;
                    }

                    // 同時起動は拒否する
                    if (anotherInstanceRunning)
                    {
                        MyLog.LogWrite("既にサーバーが起動中です。二重起動はできません。");
                        Thread.Sleep(3000);
                        return;
                    }

                    Thread.Sleep(1000);
                    Start(fileManager).Wait();
                    GC.Collect();
                }
                finally
                {
                    mutex?.ReleaseMutex();
                    mutex?.Dispose();
                }
            }
        }

        private static void Canceler(object? sender, ConsoleCancelEventArgs e)
        {
            cancelHandler?.Invoke();
        }

        public static void Stop()
        {
            MyLog.LogWrite("サーバーを再起動します...");
            cts.Cancel();
        }

        static async Task Start(FileManager fileManager)
        {
            try
            {
                using (cts = new CancellationTokenSource())
                {
                    // コンソールモニターの起動
                    MyLog.LogWrite("コンソールモニターの起動");
                    ConsoleMonitor consoleMonitor = new ConsoleMonitor(fileManager);
                    consoleMonitor.Start(fileManager.generalSettings.EnableConsoleMonitor, cts.Token);

                    // 定期バックアップのスケジューリング
                    MyLog.LogWrite("定期バックアップのスケジューリング");
                    Backup.ScheduleDailyBackup(consoleMonitor, cts.Token);

                    // 定期アップデートチェックのスケジューリング
                    if (fileManager.generalSettings.EnableAutoUpdateCheck)
                    {
                        MyLog.LogWrite("定期アップデートチェックのスケジューリング");
                        UpdateChecker.ScheduleRegularUpdates(consoleMonitor, cts.Token);
                    }
                    else
                    {
                        MyLog.LogWrite("自動アップデートチェックは無効化されています");
                    }

                    // 画像生成器の初期化
                    MyLog.LogWrite("画像生成器の初期化");
                    ImageGenerater imageGenerater = new ImageGenerater(fileManager);

                    // ツールの初期化
                    MyLog.LogWrite("ツールの初期化");
                    await using Tools tools = new Tools(imageGenerater, fileManager, consoleMonitor);
                    await tools.InitToolsAsync();

                    // LLMの初期化
                    MyLog.LogWrite("LLMの初期化");
                    LLM llm = new LLM(fileManager, consoleMonitor, tools);

                    // ペルソナの初期化
                    MyLog.LogWrite("ペルソナの初期化");
                    Persona persona = new Persona(fileManager, consoleMonitor, llm);

                    // 1分おきの定期処理の開始
                    MyLog.LogWrite("定期処理の開始");
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            while (!cts.Token.IsCancellationRequested)
                            {
                                await persona.PerformPeriodicTasks(cancellationToken: cts.Token);
                                await Task.Delay(TimeSpan.FromMinutes(1), cts.Token);
                            }
                        }
                        catch (OperationCanceledException)
                        {
                            // キャンセル時の例外は無視
                        }
                    });


                    // Webサーバーの起動
                    MyLog.LogWrite("Webサーバーの起動");
                    WebServer server = new WebServer(consoleMonitor, persona);
                    Broadcaster.Initialize(server.Broadcast);

                    // Windowsならブラウザを起動する
                    if (Environment.OSVersion.Platform == PlatformID.Win32NT)
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = $"http://localhost:{fileManager.generalSettings.HttpPort}/",
                            UseShellExecute = true
                        });
                    }

                    cancelHandler = () =>
                    {
                        if (exit) return;
                        MyLog.LogWrite("サーバーを停止しています...");
                        exit = true;
                        cts.Cancel();
                        server.Stop();
                    };

                    MyLog.LogWrite($"開始: port {fileManager.generalSettings.HttpPort}");
                    server.RunSync(fileManager.generalSettings.HttpPort, fileManager.generalSettings.LocalOnly, fileManager.generalSettings.SystemSettingsLocalOnly, cts.Token);
                    MyLog.LogWrite($"終了");
                }
            }
            catch (Exception ex)
            {
                MyLog.LogWrite("トップレベル例外! 致命的なエラーが発生しました: " + ex.Message);
                MyLog.LogWrite(ex.StackTrace ?? "");
            }
        }
    }
}