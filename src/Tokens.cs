using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Tiktoken;

namespace CllDotnet
{
    public static class Tokens
    {
        static Encoder encoder = ModelToEncoder.For("gpt-4o"); // 代表としてGPT-4oのエンコーダを使用(固定)
        public static int CountTokens(string input)
        {
            return encoder.CountTokens(input);
        }
        public static int CountTokens(string text, string toolDetail)
        {
            return encoder.CountTokens(text + (string.IsNullOrEmpty(toolDetail) ? "" : $"\n\n{toolDetail}"));
        }

        // トーク履歴全体のトークン数をカウントする
        public static int CountTalkTokens(IEnumerable<TalkEntry> inputs)
        {
            int totalTokens = 0;
            foreach (var entry in inputs)
            {
                totalTokens += entry.Tokens;

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
        public static List<TalkEntry> TrimTalkTokens(string systemPrompt, List<TalkEntry> inputs, int maxTokens)
        {
            List<TalkEntry> result = new List<TalkEntry>();
            int totalTokens = CountTokens(systemPrompt);

            // ツールや自動挿入が概ね200トークンなので加算しておく(全部オフにすると0になるが、最大値。MCPを使うともっと増えるがあくまで概算として計算しない)
            totalTokens += 200;
            
            // Token数が超過しない範囲で末尾から追加していく(トークン数は、entry.Tokensを使う)
            for (int i = inputs.Count - 1; i >= 0; i--)
            {
                var entry = inputs[i];
                if (totalTokens + entry.Tokens <= maxTokens)
                {
                    result.Insert(0, entry); // 先頭に挿入
                    totalTokens += entry.Tokens;
                }
                else
                {
                    break; // 超過したら終了
                }
            }
            return result;
        }
    }
}