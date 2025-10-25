using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Tiktoken;

namespace CllDotnet
{
    public static class Tokens
    {
        static Encoder encoder = ModelToEncoder.For("gpt-4o");
        public static int CountTokens(string input)
        {
            return encoder.CountTokens(input);
        }

        // トーク履歴全体のトークン数をカウントする
        public static int CountTalkTokens(IEnumerable<TalkEntry> inputs)
        {
            int totalTokens = 0;
            foreach (var entry in inputs)
            {
                totalTokens += CountTokens(entry.Text +
                    (string.IsNullOrEmpty(entry.ToolDetail) ? "" : $"\n\n{entry.ToolDetail}"));

                // 添付ファイル一つ辺り1024トークンと仮定(GPT-4.1)
                if (entry.AttachmentId != null)
                {
                    totalTokens += entry.AttachmentId.Count * 1024;
                }
            }

            // ツールや自動挿入が概ね200トークンなので加算しておく(全部オフにすると0になるが、最大値。MCPを使うともっと増えるがあくまで概算として計算しない)
            totalTokens += 200;
            return totalTokens;
        }

        // システムプロンプトとトーク履歴を末尾から合算したとき、指定のトークン数に収まる切り出されたトーク履歴を返す
        public static List<TalkEntry> TrimTalkTokens(string systemPrompt, IEnumerable<TalkEntry> inputs, int maxTokens)
        {
            List<TalkEntry> result = new List<TalkEntry>();
            int totalTokens = CountTokens(systemPrompt);

            // 末尾からトーク履歴を追加していく
            var reversedInputs = new List<TalkEntry>(inputs);
            reversedInputs.Reverse();
            foreach (var entry in reversedInputs)
            {
                int entryTokens = CountTokens(entry.Text +
                    (string.IsNullOrEmpty(entry.ToolDetail) ? "" : $"\n\n{entry.ToolDetail}"));
                if ((totalTokens + entryTokens) > maxTokens)
                {
                    break;
                }

                result.Add(entry);
                totalTokens += entryTokens;
            }

            // 順序を元に戻す
            result.Reverse();
            return result;
        }
    }
}