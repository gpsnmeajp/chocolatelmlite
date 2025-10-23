using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;

namespace CllDotnet
{
    public static class DangerousChecker
    {
        // ファイル名が危険な拡張子を持っているかチェックするメソッド
        public static bool IsDangerousFileName(string fileName)
        {
            var safeExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                ".txt", ".md", ".json", ".xml", ".csv", ".log", ".yml", ".yaml", ".html", ".htm", ".css", ".js",
                ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"
            };

            var fileExtension = Path.GetExtension(fileName).ToLowerInvariant();
            return !safeExtensions.Contains(fileExtension);
        }
    }
}