using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace CllDotnet
{
    public class SearchLlm
    {
        private readonly FileManager _fileManager;

        public SearchLlm(FileManager fileManager)
        {
            _fileManager = fileManager;
        }

        public async Task<string> SearchAsync(string prompt)
        {
            var settings = _fileManager.generalSettings;

            if (!settings.EnableSearchLlm)
            {
                var ret = "検索LLMは無効化されています。";
                MyLog.LogWrite(ret);
                return ret;
            }

            if (string.IsNullOrWhiteSpace(settings.SearchLlmEndpointUrl) || string.IsNullOrWhiteSpace(settings.SearchLlmApiKey))
            {
                var ret = "検索LLMのエンドポイントURLまたはAPIキーが設定されていません。";
                MyLog.LogWrite(ret);
                return ret;
            }

            if (string.IsNullOrWhiteSpace(settings.SearchLlmModel))
            {
                var ret = "検索LLMモデルが設定されていません。";
                MyLog.LogWrite(ret);
                return ret;
            }

            if (string.IsNullOrWhiteSpace(prompt))
            {
                var ret = "検索プロンプトが空です。";
                MyLog.LogWrite(ret);
                return ret;
            }

            MyLog.LogWrite($"検索LLMを呼び出します。プロンプト: {prompt} モデル: {settings.SearchLlmModel} エンドポイント: {settings.SearchLlmEndpointUrl}");

            // 現在日時の取得(タイムゾーン設定を考慮)
            var timeZone = _fileManager.GetTimeZoneInfo();
            var localTime = TimeZoneInfo.ConvertTime(DateTime.UtcNow, timeZone);
            string datetimeString = localTime.ToString("yyyy-MM-dd (ddd) HH:mm:ss");

            var requestBody = new
            {
                model = settings.SearchLlmModel,
                messages = new[]
                {
                    new { role = "system", content = $"あなたはWeb検索エージェントです。\nユーザーの求める情報の背景を深く洞察し、検索結果にのみ基づいて回答してください。\n検索結果が不足しており回答できない場合は、分かる範囲の情報とともに、回答できない旨を正直に伝えてください。\n応答結果はLLMに理解しやすいYAML形式で出力してください。\n\n現在時刻: {datetimeString}" },
                    new { role = "user", content = $"{prompt}\n\n<system>ユーザーの求める情報の背景を深く洞察し、検索結果にのみ基づいて回答してください。\n検索結果が不足しており回答できない場合は、分かる範囲の情報とともに、回答できない旨を正直に伝えてください。\n応答結果はLLMに理解しやすいYAML形式で出力してください。</system>" }
                }
            };

            using var httpClient = new HttpClient();
            httpClient.Timeout = TimeSpan.FromSeconds(settings.TimeoutSeconds);

            var endpoint = settings.SearchLlmEndpointUrl + (settings.SearchLlmEndpointUrl.EndsWith("/") ? string.Empty : "/") + "chat/completions";
            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, endpoint);
            httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.SearchLlmApiKey);
            httpRequest.Headers.Add("X-Title", "Chocolate LM Lite");
            httpRequest.Headers.Add("HTTP-Referer", "https://github.com/gpsnmeajp/chocolatelmlite");

            var jsonPayload = JsonSerializer.Serialize(requestBody);
            if (settings.DebugMode)
            {
                MyLog.DebugFileWrite("search_llm_request.json", jsonPayload);
            }
            httpRequest.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

            using var httpResponse = await httpClient.SendAsync(httpRequest);
            if (!httpResponse.IsSuccessStatusCode)
            {
                int statusCodeEx = (int)httpResponse.StatusCode;
                string addition = string.Empty;
                switch (statusCodeEx)
                {
                    case 0:
                        addition = "ネットワークに接続できません。エンドポイントURLやネットワーク環境をご確認ください。";
                        break;
                    case 400:
                        addition = "リクエストが不正です。入力値の不足・形式の誤り、またはCORSの問題が考えられます。";
                        break;
                    case 401:
                        addition = "認証に失敗しました。APIキーが無効か期限切れの可能性があります。";
                        break;
                    case 402:
                        addition = "クレジット残高不足です。クレジットを追加して再試行してください。";
                        break;
                    case 403:
                        addition = "利用が許可されていない、URLが間違っている、あるいは、入力が有害と判断され拒否されました。内容を見直してください。(あるいは、単に利用上限に達したかも知れません)";
                        break;
                    case 404:
                        addition = "モデルが見つかりません。モデル名が正しいか確認してください。";
                        break;
                    case 408:
                        addition = "タイムアウトしました。再試行するか、Base URLやネットワーク環境をご確認ください。";
                        break;
                    case 429:
                        addition = "リクエストが多すぎます。しばらく待ってから再試行してください。";
                        break;
                    case 500:
                        addition = "サーバー内部に問題が発生しています。しばらく待ってから再試行してください。";
                        break;
                    case 502:
                        addition = "通信に失敗しました。接続先が合っている場合、選択したモデルがダウンしているか、不正な応答を返しました。モデル変更や再試行を検討してください。";
                        break;
                    case 503:
                        addition = "要求を満たすプロバイダが見つかりません。ルーティング条件やモデル設定を見直してください。";
                        break;
                }

                var ret = $"検索LLMの呼び出しに失敗しました。StatusCode: {(int)httpResponse.StatusCode} {addition}";
                MyLog.LogWrite(ret);
                return ret;
            }

            var responseContent = await httpResponse.Content.ReadAsStringAsync();
            if (settings.DebugMode)
            {
                MyLog.DebugFileWrite("search_llm_response.json", responseContent);
            }

            using var document = JsonDocument.Parse(responseContent);
            if (document.RootElement.TryGetProperty("choices", out var choicesElement) && choicesElement.GetArrayLength() > 0)
            {
                var messageElement = choicesElement[0].GetProperty("message");
                if (messageElement.TryGetProperty("content", out var contentElement))
                {
                    var textResponse = contentElement.GetString() ?? string.Empty;
                    var annotationLines = new List<string>();

                    // OpenRouter-style annotations
                    if (messageElement.TryGetProperty("annotations", out var annotationsElement) && annotationsElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var ann in annotationsElement.EnumerateArray())
                        {
                            if (ann.TryGetProperty("type", out var typeElement) && typeElement.GetString() == "url_citation")
                            {
                                if (ann.TryGetProperty("url_citation", out var urlCitation) && urlCitation.ValueKind == JsonValueKind.Object)
                                {
                                    var url = urlCitation.TryGetProperty("url", out var urlEl) ? (urlEl.GetString() ?? string.Empty) : string.Empty;
                                    var title = urlCitation.TryGetProperty("title", out var titleEl) ? (titleEl.GetString() ?? string.Empty) : string.Empty;
                                    if (!string.IsNullOrWhiteSpace(url))
                                    {
                                        var label = string.IsNullOrWhiteSpace(title) ? url : title;
                                        annotationLines.Add($"{annotationLines.Count + 1}. {label} - {url}");
                                    }
                                }
                            }
                        }
                    }

                    // Fallback: top-level citations list
                    if (annotationLines.Count == 0 && document.RootElement.TryGetProperty("citations", out var citationsElement) && citationsElement.ValueKind == JsonValueKind.Array)
                    {
                        int idx = 1;
                        foreach (var cite in citationsElement.EnumerateArray())
                        {
                            var url = cite.GetString();
                            if (!string.IsNullOrWhiteSpace(url))
                            {
                                annotationLines.Add($"{idx}. {url}");
                                idx++;
                            }
                        }
                    }

                    if (annotationLines.Count > 0)
                    {
                        textResponse += "\n\n出展:\n" + string.Join("\n", annotationLines);
                    }

                    MyLog.LogWrite($"検索LLMの応答内容: {textResponse}");
                    return $"<system>以下は、検索LLMからの応答結果です。ユーザーへの応答に適切に活用してください。</system>\n\n<SearchResult>\n{textResponse}\n</SearchResult>\n\n<system>以上が、検索LLMからの応答結果です。</system>";
                }
            }

            MyLog.LogWrite("検索LLMの応答を解析できませんでした。");
            return "検索結果の取得に失敗しました。検索クエリや設定を見直してください。";
        }
    }
}
