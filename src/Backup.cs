using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace CllDotnet
{
    public static class Backup
    {
        public static void ScheduleDailyBackup(ConsoleMonitor consoleMonitor, CancellationToken cts)
        {
            // 起動時および24時間ごとにバックアップを作成するタスク
            Task.Run(async () =>
            {
                while (!cts.IsCancellationRequested)
                {
                    try
                    {
                        CreateBackup(consoleMonitor);
                    }
                    catch (Exception ex)
                    {
                        MyLog.LogWrite($"バックアップ作成中にエラーが発生: {ex.Message} {ex.StackTrace}");
                    }
                    // 24時間待機
                    await Task.Delay(TimeSpan.FromHours(24), cts);
                }
            }, cts);
        }

        public static void CreateBackup(ConsoleMonitor consoleMonitor)
        {
            // dataフォルダを、backupフォルダ配下に、日時付きでコピーする(バックアップ機能はシステムロケール時刻を使用)
            var timestamp = DateTime.Now.ToString("yyyyMMdd");
            var sourceDir = "data";
            var backupBaseDir = "backup";
            var backupDir = System.IO.Path.Combine(backupBaseDir, timestamp);

            if (!System.IO.Directory.Exists(sourceDir))
            {
                MyLog.LogWrite($"バックアップ対象のディレクトリが見つかりません: {sourceDir}");
                return;
            }

            // 同じ日に複数回バックアップを作成しないようにする
            if (System.IO.Directory.Exists(backupDir))
            {
                MyLog.LogWrite($"本日は既にバックアップが作成されています: {backupDir}");
                return;
            }

            MyLog.LogWrite($"バックアップを作成: {backupDir}");
            System.IO.Directory.CreateDirectory(backupBaseDir);
            FileManager.CopyDirectory(sourceDir, backupDir);

            // 7世代以上前のバックアップは削除する
            var backupDirs = new List<string>(System.IO.Directory.GetDirectories(backupBaseDir));
            backupDirs.Sort();
            while (backupDirs.Count > 7)
            {
                var dirToDelete = backupDirs[0];
                MyLog.LogWrite($"古いバックアップを削除: {dirToDelete}");
                System.IO.Directory.Delete(dirToDelete, true);
                backupDirs.RemoveAt(0);
            }

            consoleMonitor.UpdateInfo("最終バックアップ", DateTime.Now.ToString("yyyy/MM/dd HH:mm:ss"));
        }
    }
}