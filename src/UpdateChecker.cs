using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace CllDotnet
{
    public static class UpdateChecker
    {
        const string CurrentVersion = "0.01"; // 現在のバージョン
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
                        CheckForUpdates(consoleMonitor);
                    }
                    catch (Exception ex)
                    {
                        MyLog.LogWrite($"アップデートチェック中にエラーが発生: {ex.Message} {ex.StackTrace}");
                    }
                    // 24時間待機
                    await Task.Delay(TimeSpan.FromHours(24), cts);
                }
            }, cts);
        }

        public static void CheckForUpdates(ConsoleMonitor consoleMonitor)
        {
            // バージョン情報をダウンロードし、JSONを解析してバージョン番号が違うなら通知する
            MyLog.LogWrite($"アップデート情報をチェックしています... {UpdateCheckUrl}");
            using (var client = new System.Net.Http.HttpClient())
            {
                string json = client.GetStringAsync(UpdateCheckUrl).Result;
                var doc = JsonSerializer.Deserialize<JsonDocument>(json);
                
                if (doc != null && doc.RootElement.TryGetProperty("ver", out var verElement))
                {
                    string latestVersion = verElement.GetString() ?? CurrentVersion;
                    if (latestVersion != CurrentVersion)
                    {
                        consoleMonitor.UpdateInfo("アップデート情報", $"ℹ️ 新しいバージョンが利用可能です: {latestVersion} (現在のバージョン: {CurrentVersion})");
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