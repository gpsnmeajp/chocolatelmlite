using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace CllDotnet
{
    public static class UpdateChecker
    {
        const string CurrentVersion = "0.01e"; // 現在のバージョン
        const string UpdateCheckUrl = "https://sabowl.sakura.ne.jp/api/chocolatelm/version.json"; // アップデート情報のURL

        /*
        {
            "ver": "0.01"
        }
        */

        public static void ScheduleRegularUpdates(ConsoleMonitor consoleMonitor, CancellationToken cts)
        {
            // 起動時および24時間ごとにアップデートをチェックするタスク
            Task.Run(async () =>
            {
                while (!cts.IsCancellationRequested)
                {
                    try
                    {
                        await CheckForUpdates(consoleMonitor);
                    }
                    catch (Exception ex)
                    {
                        MyLog.LogWrite($"アップデートチェック中にエラーが発生: {ex.Message} {ex.StackTrace}");
                    }
                    // 24時間待機
                    try
                    {
                        await Task.Delay(TimeSpan.FromHours(24), cts);
                    }
                    catch (TaskCanceledException)
                    {
                        // キャンセルされた場合は無視
                    }
                }
            }, cts);
        }

        public static async Task CheckForUpdates(ConsoleMonitor consoleMonitor)
        {
            // バージョン情報をダウンロードし、JSONを解析してバージョン番号が違うなら通知する
            MyLog.LogWrite($"アップデート情報をチェックしています... {UpdateCheckUrl}");
            using (var client = new System.Net.Http.HttpClient())
            {
                string json = await client.GetStringAsync(UpdateCheckUrl);
                using (var doc = JsonSerializer.Deserialize<JsonDocument>(json))
                {
                    if (doc != null && doc.RootElement.TryGetProperty("ver", out var verElement))
                    {
                        string latestVersion = verElement.GetString() ?? CurrentVersion;
                        if (latestVersion != CurrentVersion)
                        {
                            consoleMonitor.UpdateInfo("アップデート情報", $"新しいバージョンが利用可能です: {latestVersion} (現在のバージョン: {CurrentVersion})");
                            MyLog.LogWrite($"新しいバージョンが利用可能です: {latestVersion} (現在のバージョン: {CurrentVersion})");
                        }
                        else
                        {
                            MyLog.LogWrite("現在のバージョンは最新です。");
                        }
                    }
                    else
                    {
                        MyLog.LogWrite("アップデート情報の取得に失敗しました: バージョン情報が見つかりません。");
                    }
                }
            }
        }
    }
}