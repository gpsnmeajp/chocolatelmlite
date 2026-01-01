using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;

namespace CllDotnet
{
    public static class SystemPrompt
    {
        // システムプロンプトを構築するメソッド
        public static string BuildSystemPrompt(FileManager fileManager, bool noStats = false)
        {
            var generalSettings = fileManager.generalSettings;
            string systemPrompt = fileManager.GetSystemPromptFromActivePersona();
            string additionalInfo = string.Empty;

            // 動的にシステムプロンプトを拡張する処理

            // メモリ情報を追加
            if (generalSettings.EnableMemory)
            {
                var memory = fileManager.GetActivePersonaMemory().MemoryEntries;
                foreach (var entry in memory)
                {
                    additionalInfo += $"\n\n<memory id='{entry.Id}' updated_at='{entry.UpdatedAt}'>{entry.Text}</memory>";
                }
            }

            // プロジェクト情報を追加
            if (generalSettings.EnableProject)
            {
                var fileList = fileManager.GetProjectFileListFromActivePersona();
                additionalInfo += $"\n\n<project_files>\n{string.Join("\n", fileList)}\n</project_files>";
            }

            // 会話統計情報と休憩リマインダーを追加
            if (generalSettings.EnableStatisticsAndBreakReminder && !noStats)
            {
                var stats = fileManager.GetTalkStatsFromActivePersona();
                if (stats != null)
                {
                    additionalInfo += $"\n\n<conversations_statistics total='{stats.Total}' archived='{stats.Archived}' user_messages_last_8h='{stats.UserLast8h}' total_tokens='{stats.TotalTokens}'";
                    if (stats.NeedUserRestRemind)
                    {
                        additionalInfo += $" need_rest_reminder='{stats.NeedUserRestRemind}'";
                    }
                    additionalInfo += $"/>";
                }
            }

            if (additionalInfo.Length > 0)
            {
                systemPrompt += $"\n\n<system>{additionalInfo}</system>";
            }

            return systemPrompt;
        }
    }
}