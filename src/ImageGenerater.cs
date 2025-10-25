using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text;

namespace CllDotnet
{
    public class ImageGenerater
    {
        private readonly FileManager _fileManager;

        public ImageGenerater(FileManager fileManager)
        {
            _fileManager = fileManager;
        }

        public async Task<(string, int?)> GenerateImage(string prompt)
        {
            var settings = _fileManager.generalSettings;
            if (!settings.EnableImageGeneration)
            {
                var ret = "画像生成は無効化されています。";
                MyLog.LogWrite(ret);
                return (ret, null);
            }

            if (string.IsNullOrEmpty(settings.ImageGenerationEndpointUrl) || string.IsNullOrEmpty(settings.ImageGenerationApiKey))
            {
                var ret = "画像生成のエンドポイントURLまたはAPIキーが設定されていません。";
                MyLog.LogWrite(ret);
                return (ret, null);
            }

            if (string.IsNullOrEmpty(settings.ImageGenerationModel))
            {
                var ret = "画像生成モデルが設定されていません。";
                MyLog.LogWrite(ret);
                return (ret, null);
            }

            if (string.IsNullOrWhiteSpace(prompt))
            {
                var ret = "プロンプトが空です。";
                MyLog.LogWrite(ret);
                return (ret, null);
            }

            prompt = $"画像を生成してください。内容は以下です。\n\n```\n{prompt}\n```\n\nまた、画像の内容について説明してください。";
            MyLog.LogWrite($"画像生成を開始します。プロンプト: {prompt} モデル: {settings.ImageGenerationModel} エンドポイント: {settings.ImageGenerationEndpointUrl}");

            // 画像生成APIへのリクエストを構築
            var requestBody = new
            {
                model = settings.ImageGenerationModel,
                messages = new[]
                {
                    new { role = "user", content = prompt }
                },
                modalities = new[] { "image", "text" }
            };

            // HTTPクライアントを使用してAPIを呼び出し
            using var httpClient = new HttpClient();

            // タイムアウト設定
            httpClient.Timeout = TimeSpan.FromSeconds(settings.TimeoutSeconds);

            // リクエストの設定
            var endpoint = settings.ImageGenerationEndpointUrl + (settings.ImageGenerationEndpointUrl.EndsWith("/") ? "" : "/") + "chat/completions";
            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, endpoint);

            // 認証ヘッダーの追加
            httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ImageGenerationApiKey);

            // ヘッダーを追加
            httpRequest.Headers.Add("X-Title", "Chocolate LM Lite");
            httpRequest.Headers.Add("HTTP-Referer", "https://github.com/gpsnmeajp/chocolatelmlite");

            // リクエストボディのシリアライズ
            var jsonPayload = JsonSerializer.Serialize(requestBody);

            if (settings.DebugMode)
            {
                MyLog.DebugFileWrite("image_generation_request.json", jsonPayload);
            }
            httpRequest.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

            // API呼び出しの実行
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
                        addition = "利用が許可されていない、URLが間違っている、あるいは、入力が有害と判断され拒否されました。内容を見直してください。";
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

                var ret = $"画像生成の呼び出しに失敗しました。StatusCode: {(int)httpResponse.StatusCode} {addition}";
                MyLog.LogWrite(ret);
                return (ret, null);
            }

            // レスポンスの処理(OpenRouter画像生成仕様に基づく)
            var responseContent = await httpResponse.Content.ReadAsStringAsync();

            if (settings.DebugMode)
            {
                MyLog.DebugFileWrite("image_generation_response.json", responseContent);
            }

            string textResponse = string.Empty;

            // レスポンスから生成された画像URLを抽出してログに出力
            using var document = JsonDocument.Parse(responseContent);
            if (document.RootElement.TryGetProperty("choices", out var choicesElement) && choicesElement.GetArrayLength() > 0)
            {
                var messageElement = choicesElement[0].GetProperty("message");
                if (messageElement.TryGetProperty("content", out var contentElement))
                {
                    var textContent = contentElement.GetString() ?? string.Empty;
                    textResponse = textContent;
                }
                else
                {
                    MyLog.LogWrite("レスポンスにテキストコンテンツが含まれていません。");
                }

                if (messageElement.TryGetProperty("images", out var imagesElement))
                {
                    foreach (var imageElement in imagesElement.EnumerateArray())
                    {
                        if (imageElement.TryGetProperty("image_url", out var imageUrlElement) &&
                            imageUrlElement.TryGetProperty("url", out var urlElement))
                        {
                            var imageUrl = urlElement.GetString() ?? string.Empty;

                            // Base64データの場合はファイルに保存
                            if (imageUrl.StartsWith("data:image/"))
                            {
                                // MIMEタイプから拡張子を取得
                                var extensionReg = Regex.Match(imageUrl, @"data:image/(.+?);base64");
                                var extension = extensionReg.Groups.Count > 1 ? extensionReg.Groups[1].Value : "png";

                                MyLog.LogWrite($"画像生成に成功しました。拡張子: {extension} Success: {extensionReg.Success}");
                                var base64Data = imageUrl.Substring(imageUrl.IndexOf(",") + 1);
                                var imageBytes = Convert.FromBase64String(base64Data);

                                int? id = _fileManager.SaveAttachmentToActivePersona($"tmp.{extension}", imageBytes);
                                MyLog.LogWrite($"画像生成LLMからの応答内容: {textResponse} : {id}");
                                return (textResponse, id);
                            }
                            else
                            {
                                // 通常こちらに来ることはない
                                MyLog.LogWrite($"画像生成に成功しました。URL: {imageUrl}");
                                var ret = $"画像生成LLMからの応答内容: {textResponse} : {imageUrl}";
                                MyLog.LogWrite(ret);
                                return (ret, null);
                            }
                        }
                        else
                        {
                            MyLog.LogWrite("レスポンスに画像URLが含まれていません。");
                        }
                    }
                }else
                {
                    MyLog.LogWrite("レスポンスに画像データが含まれていません。");
                }
            }else{
                MyLog.LogWrite("レスポンスにchoicesが含まれていません。");
            }

            var finalRet = $"画像生成LLMからの応答内容: {textResponse}";
            MyLog.LogWrite(finalRet);
            return (finalRet, null);
        }
    }
}