using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace CllDotnet
{
    public class SummaryLlm
    {
        private readonly FileManager _fileManager;

        public SummaryLlm(FileManager fileManager)
        {
            _fileManager = fileManager;
        }

        public async Task<(bool Success, string Message, string? SummaryText)> GenerateSummaryAsync(string summaryPrompt, List<TalkEntry> talkEntries, int summarizeTurns, CancellationToken cancellationToken)
        {
            var settings = _fileManager.generalSettings;

            if (string.IsNullOrWhiteSpace(settings.SummaryLlmEndpointUrl) || string.IsNullOrWhiteSpace(settings.SummaryLlmApiKey))
            {
                var ret = "要約LLMのエンドポイントURLまたはAPIキーが設定されていません。";
                MyLog.LogWrite(ret);
                return (false, ret, null);
            }

            if (string.IsNullOrWhiteSpace(settings.SummaryLlmModel))
            {
                var ret = "要約LLMモデルが設定されていません。";
                MyLog.LogWrite(ret);
                return (false, ret, null);
            }

            if (talkEntries == null || talkEntries.Count == 0)
            {
                var ret = "要約できる会話履歴がありません。";
                MyLog.LogWrite(ret);
                return (false, ret, null);
            }

            if (string.IsNullOrWhiteSpace(summaryPrompt))
            {
                var ret = "要約プロンプトが空です。";
                MyLog.LogWrite(ret);
                return (false, ret, null);
            }

            var limitedEntries = LimitTalkEntries(talkEntries, summarizeTurns);

            var historyText = BuildTalkHistoryText(limitedEntries);

            var requestBody = new
            {
                model = settings.SummaryLlmModel,
                messages = new[]
                {
                    new { role = "system", content = summaryPrompt },
                    new { role = "user", content = $"<talk_history>\n{historyText}\n</talk_history>\n\n<system>{summaryPrompt}</system>" }
                }
            };

            using var httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(settings.TimeoutSeconds)
            };

            var endpoint = settings.SummaryLlmEndpointUrl + (settings.SummaryLlmEndpointUrl.EndsWith("/") ? string.Empty : "/") + "chat/completions";
            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, endpoint);
            httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.SummaryLlmApiKey);
            httpRequest.Headers.Add("X-Title", "Chocolate LM Lite");
            httpRequest.Headers.Add("HTTP-Referer", "https://github.com/gpsnmeajp/chocolatelmlite");

            var jsonPayload = JsonSerializer.Serialize(requestBody);
            if (settings.DebugMode)
            {
                MyLog.DebugFileWrite("summary_generation_request.json", jsonPayload);
            }

            httpRequest.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

            using var httpResponse = await httpClient.SendAsync(httpRequest, cancellationToken);
            if (!httpResponse.IsSuccessStatusCode)
            {
                int statusCodeEx = (int)httpResponse.StatusCode;
                string addition = statusCodeEx switch
                {
                    0 => "ネットワークに接続できません。エンドポイントURLやネットワーク環境をご確認ください。",
                    400 => "リクエストが不正です。入力値の不足・形式の誤り、またはCORSの問題が考えられます。",
                    401 => "認証に失敗しました。APIキーが無効か期限切れの可能性があります。",
                    402 => "クレジット残高不足です。クレジットを追加して再試行してください。",
                    403 => "利用が許可されていない、URLが間違っている、あるいは、入力が有害と判断され拒否されました。内容を見直してください。(あるいは、単に利用上限に達したかも知れません)",
                    404 => "モデルが見つかりません。モデル名が正しいか確認してください。",
                    408 => "タイムアウトしました。再試行するか、Base URLやネットワーク環境をご確認ください。",
                    429 => "リクエストが多すぎます。しばらく待ってから再試行してください。",
                    500 => "サーバー内部に問題が発生しています。しばらく待ってから再試行してください。",
                    502 => "通信に失敗しました。接続先が合っている場合、選択したモデルがダウンしているか、不正な応答を返しました。モデル変更や再試行を検討してください。",
                    503 => "要求を満たすプロバイダが見つかりません。ルーティング条件やモデル設定を見直してください。",
                    _ => string.Empty
                };

                var ret = $"要約LLMの呼び出しに失敗しました。StatusCode: {(int)httpResponse.StatusCode} {addition}";
                MyLog.LogWrite(ret);
                return (false, ret, null);
            }

            var responseContent = await httpResponse.Content.ReadAsStringAsync(cancellationToken);
            if (settings.DebugMode)
            {
                MyLog.DebugFileWrite("summary_generation_response.json", responseContent);
            }

            using var document = JsonDocument.Parse(responseContent);
            if (document.RootElement.TryGetProperty("choices", out var choicesElement) && choicesElement.GetArrayLength() > 0)
            {
                var messageElement = choicesElement[0].GetProperty("message");
                if (messageElement.TryGetProperty("content", out var contentElement))
                {
                    var textResponse = contentElement.GetString() ?? string.Empty;
                    MyLog.LogWrite("要約LLMの生成に成功しました。");
                    return (true, "success", textResponse.Trim());
                }
            }

            MyLog.LogWrite("要約LLMの応答を解析できませんでした。");
            return (false, "要約の生成に失敗しました。", null);
        }

        // TODO: ============================================================================
        // TODO: ============================================================================
        // TODO: ============================================================================
        // TODO: あとで修正 (色々と問題がある。例えば過去の会話要約を反映する仕組みがない等)
        // TODO: サイズ制限はシステム設定で設定できるようにすべき
        // TODO: ============================================================================
        // TODO: ============================================================================
        // TODO: ============================================================================
        // TODO: ============================================================================
        private string BuildTalkHistoryText(List<TalkEntry> entries)
        {
            var timeZone = _fileManager.GetTimeZoneInfo();
            var lines = new List<string>();

            foreach (var entry in entries)
            {
                var timestamp = entry.Timestamp > 0
                    ? TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(entry.Timestamp), timeZone).ToString("yyyy-MM-dd HH:mm:ss")
                    : string.Empty;
                var attachmentInfo = entry.AttachmentId != null && entry.AttachmentId.Count > 0
                    ? $" [attachments: {string.Join(",", entry.AttachmentId)}]"
                    : string.Empty;
                var text = entry.Text ?? string.Empty;
                var line = string.IsNullOrWhiteSpace(timestamp)
                    ? $"[{entry.Role}] {text}{attachmentInfo}"
                    : $"[{entry.Role}] {timestamp} {text}{attachmentInfo}";
                lines.Add(line.Replace("\r\n", "\n"));
            }

            const int maxLength = 24000;
            int currentLength = 0;
            var selected = new List<string>();
            for (int i = lines.Count - 1; i >= 0; i--)
            {
                var line = lines[i];
                currentLength += line.Length + 1;
                selected.Add(line);
                if (currentLength >= maxLength)
                {
                    break;
                }
            }
            selected.Reverse();

            var joined = string.Join("\n", selected);
            if (selected.Count < lines.Count)
            {
                joined = "(一部のみ抜粋)\n" + joined;
            }
            return joined;
        }

        private static List<TalkEntry> LimitTalkEntries(List<TalkEntry> entries, int summarizeTurns)
        {
            if (summarizeTurns <= 0 || entries.Count <= summarizeTurns)
            {
                return entries;
            }

            return entries.Skip(Math.Max(0, entries.Count - summarizeTurns)).ToList();
        }
    }
}
