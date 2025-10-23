using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc.Razor;

namespace CllDotnet
{
    public class ConsoleMonitor
    {
        Dictionary<string, string> infoLines = new Dictionary<string, string>();
        bool enable = true;
        FileManager fileManager;

        public ConsoleMonitor(FileManager fileManager)
        {
            this.fileManager = fileManager;
        }

        public void Start(bool enable, CancellationToken cancellationToken)
        {
            this.enable = enable;
            MyLog.LogWrite($"コンソールモニター: {(enable ? "有効" : "無効")}");
            Task.Run(() =>
            {
                while (!cancellationToken.IsCancellationRequested)
                {
                    Render();
                    Thread.Sleep(500);
                }
            }, cancellationToken);
        }

        private void Render()
        {
            if (!enable) return;
            try
            {
                Console.Clear();
                Console.WriteLine();
                Console.WriteLine("Chocolate LM Lite 🍫 サーバーコンソール");

                var timeZone = fileManager.GetTimeZoneInfo();
                var localTime = TimeZoneInfo.ConvertTime(DateTime.UtcNow, timeZone);
                Console.WriteLine("現在時刻: " + localTime.ToString("yyyy/MM/dd HH:mm:ss"));
                Console.WriteLine("=============システム状態===============");
                if (infoLines.Count == 0)
                {
                    Console.WriteLine("いろいろ読み込んでいます... (最後のペルソナが重い場合、時間がかかります)");
                }
                foreach (var line in infoLines)
                {
                    Console.WriteLine($"{line.Key}: {line.Value}");
                }
                Console.WriteLine("========================================");
                Console.WriteLine("設定を変更するには、システム設定画面を開くか、general.yamlを編集してください");
                Console.WriteLine("サーバーが稼働中です。Ctrl+Cで停止します。");
            }catch
            {
                // 無視
            }
        }

        public void UpdateInfo(string key, string value)
        {
            infoLines[key] = value;
        }
    }
}