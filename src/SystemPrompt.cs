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
        public static string BuildSystemPrompt(FileManager fileManager)
        {
            var generalSettings = fileManager.generalSettings;
            string systemPrompt = BuildRawSystemPrompt(fileManager);
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

            if (additionalInfo.Length > 0)
            {
                systemPrompt += $"\n\n<system>{additionalInfo}</system>";
            }

            // 過去の会話の要約情報を追加
            var summary = fileManager.GetActivePersonaSummary();
            if (summary != null && !string.IsNullOrWhiteSpace(summary.Text))
            {
                var timeZone = fileManager.GetTimeZoneInfo();
                var updatedAt = summary.Timestamp > 0
                    ? TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(summary.Timestamp), timeZone).ToString("yyyy-MM-dd HH:mm:ss")
                    : "unknown";
                systemPrompt += $"\n\n<summary updated_at='{updatedAt}'>\n{summary.Text}\n</summary>";
            }

            return systemPrompt;
        }

        // ペルソナのシステムプロンプトにシステム共通プロンプトを連結した生のシステムプロンプトを返す
        public static string BuildRawSystemPrompt(FileManager fileManager)
        {
            string systemPrompt = fileManager.GetSystemPromptFromActivePersona();
            string globalPrompt = fileManager.generalSettings?.GlobalSystemPrompt ?? string.Empty;

            if (!string.IsNullOrWhiteSpace(globalPrompt))
            {
                systemPrompt = string.IsNullOrWhiteSpace(systemPrompt)
                    ? globalPrompt
                    : $"{systemPrompt}\n\n{globalPrompt}";
            }

            return systemPrompt;
        }
    }
}