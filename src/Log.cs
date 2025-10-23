using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;

namespace CllDotnet
{
    public static class MyLog
    {
        public static string UnescapeUnicode(string input)
        {
            if (string.IsNullOrEmpty(input)) return input;
            // \\uXXXX を実際の文字に変換
            return Regex.Replace(input, @"\\u([0-9A-Fa-f]{4})", m => ((char)Convert.ToInt32(m.Groups[1].Value, 16)).ToString());
        }

        // Unicodeエスケープを可読な文字に変換して出力するラッパー
        public static void LogWrite(string? message, [CallerMemberName] string? methodName = null)
        {
            if (message == null) return;
            // \\uXXXX を実際の文字に変換
            string decoded = UnescapeUnicode(message);

            // ログを日付別のファイルに追記 (ログ機能はシステムロケール時刻を使用)
            string logFileName = $"logs/log_{DateTime.Now:yyyyMMdd}.txt";

            var t = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}][{methodName}] {decoded}\n";
            Console.Write(t);

            // 失敗した場合に備えて10回試行
            for (int i = 0; i < 10; i++)
            {
                try
                {
                    File.AppendAllText(logFileName, t);
                    break;
                }
                catch
                {
                    Thread.Sleep(10); // 少し待ってから再試行
                }
            }
        }

        public static void DebugFileWrite(string filename, string content)
        {
            for (int i = 0; i < 10; i++)
            {
                try
                {
                    File.WriteAllText($"logs/debug_{filename}", content);
                    break;
                }
                catch
                {
                    Thread.Sleep(10);
                }
            }
        }
    }
}