using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Text.Json;

namespace CllDotnet
{
    public class OpenRouterHttpHandler : DelegatingHandler
    {
        public int lastStatusCode { get; private set; } = 0;
        private readonly FileManager _fileManager;
        public OpenRouterHttpHandler(FileManager fileManager)
        {
            _fileManager = fileManager;

            // 内部でHttpClientHandlerを使用
            InnerHandler = new HttpClientHandler();
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            // リクエスト送信をログ出力
            MyLog.LogWrite($"Sending request to {request.RequestUri} ...");

            // リクエストをデバッグファイルに保存]
            if (_fileManager.generalSettings.DebugMode)
            {
                MyLog.DebugFileWrite("request.json", request.Content != null ? await request.Content.ReadAsStringAsync() : "No Content");
            }

            // ヘッダーを追加
            request.Headers.Add("X-Title", "Chocolate LM Lite");
            request.Headers.Add("HTTP-Referer", "https://github.com/gpsnmeajp/chocolatelmlite");

            // ステータスコードを初期化
            lastStatusCode = 0;

            // 実際のHTTPリクエストを実行
            var response = await base.SendAsync(request, cancellationToken);

            // ステータスコードを保存
            lastStatusCode = (int)response.StatusCode;

            // レスポンスをデバッグファイルに保存
            if (_fileManager.generalSettings.DebugMode)
            {
                // ストリーミング処理が無効になるため注意 (なお、最終結果は問題なく届く)
                MyLog.DebugFileWrite("response.json", response.Content != null ? await response.Content.ReadAsStringAsync() : "No Content");
            }

            // 元のレスポンスを返す
            return response;
        }
    }
}