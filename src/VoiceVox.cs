using System;
using System.Collections.Generic;
using System.IO;
using System.Media;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;
using System.ComponentModel;
using Microsoft.Extensions.AI;
using ModelContextProtocol.Client;
using Jint;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using OpenAI.Audio;
using System.Collections.Concurrent;

namespace CllDotnet
{
    public class VoiceVox
    {
        private readonly FileManager _fileManager;
        private readonly ConsoleMonitor _consoleMonitor;
        private readonly CancellationToken _cts;
        private const string VoiceVoxBaseUrl = "http://localhost:50021";
        private const int DefaultSpeakerId = 1;
        private const bool EnableKatakanaEnglish = true;
        private const bool EnableInterrogativeUpspeak = true;
        private static readonly HttpClient HttpClient = new()
        {
            BaseAddress = new Uri(VoiceVoxBaseUrl),
            Timeout = TimeSpan.FromSeconds(15)
        };
        string currentMessageBuffer = "";
        Guid currentMessageId = Guid.Empty;
        ConcurrentQueue<SynthesisRequest> queue = new();

        class SynthesisRequest
        {
            public Guid MessageId { get; set; }
            public required string Text { get; set; }
        }

        public VoiceVox(FileManager fileManager, ConsoleMonitor consoleMonitor, CancellationToken cts)
        {
            _fileManager = fileManager;
            _consoleMonitor = consoleMonitor;
            _cts = cts;

            Task.Run(async () =>
            {
                while (!cts.IsCancellationRequested)
                {
                    try
                    {
                        await CheckBufferAsync();
                    }
                    catch (Exception ex)
                    {
                        MyLog.LogWrite($"バッファチェック中にエラーが発生: {ex.Message} {ex.StackTrace}");
                    }
                    try
                    {
                        await Task.Delay(TimeSpan.FromMilliseconds(50), cts);
                    }
                    catch (TaskCanceledException)
                    {
                        // キャンセルされた場合は無視
                    }
                }
            }, cts);
        }

        private async Task CheckBufferAsync()
        {
            while (queue.TryDequeue(out var request))
            {
                MyLog.LogWrite($"音声合成開始: {request.Text}");
                try
                {
                    var audioData = await CreateSpeechAsync(request.Text, _cts);
                    if (audioData.Length > 0)
                    {
                        string data = Convert.ToBase64String(audioData);
                        await Broadcaster.Broadcast(new Dictionary<string, object> { { "speak", data } });
                    }
                    MyLog.LogWrite($"音声合成完了: {request.Text}");
                }
                catch (OperationCanceledException)
                {
                    MyLog.LogWrite("音声合成がキャンセルされました。");
                    return;
                }
                catch (Exception ex)
                {
                    MyLog.LogWrite($"音声合成中にエラーが発生: {ex.Message} {ex.StackTrace}");
                }
            }
        }

        private async Task<byte[]> CreateSpeechAsync(string text, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return Array.Empty<byte>();
            }

            var queryUrl = $"/audio_query?text={Uri.EscapeDataString(text)}&speaker={DefaultSpeakerId}&enable_katakana_english={EnableKatakanaEnglish.ToString().ToLowerInvariant()}";
            using var audioQueryResponse = await HttpClient.PostAsync(queryUrl, content: null, cancellationToken);
            audioQueryResponse.EnsureSuccessStatusCode();

            var audioQueryJson = await audioQueryResponse.Content.ReadAsStringAsync(cancellationToken);
            using var audioQueryContent = new StringContent(audioQueryJson, System.Text.Encoding.UTF8, "application/json");

            var synthesisUrl = $"/synthesis?speaker={DefaultSpeakerId}&enable_interrogative_upspeak={EnableInterrogativeUpspeak.ToString().ToLowerInvariant()}";
            using var synthesisResponse = await HttpClient.PostAsync(synthesisUrl, audioQueryContent, cancellationToken);
            synthesisResponse.EnsureSuccessStatusCode();

            return await synthesisResponse.Content.ReadAsByteArrayAsync(cancellationToken);
        }

        // 新しいメッセージの開始
        public async Task InitializeAsync()
        {
            currentMessageBuffer = "";
            currentMessageId = Guid.NewGuid();
            MyLog.LogWrite($"音声合成初期化: {currentMessageId}");
        }
        // 中間メッセージ
        public async Task ProgressAsync(string text)
        {
            // UUIDが設定されいなければ終わり
            if (currentMessageId == Guid.Empty)
            {
                return;
            }

            // ループ開始
            // カレントバッファと比較し、差分を取得
            // 差分の中に「。」あるいは「. 」あるいは改行があれば、その位置までを音声合成キューに回し、カレントバッファに追加
            // ループ終了
            while (true)
            {
                string diff = text.Substring(currentMessageBuffer.Length);
                int periodIndex = diff.IndexOf('。');
                int dotIndex = diff.IndexOf(". ");
                int newlineIndex = diff.IndexOf('\n');

                int splitIndex = -1;
                if (periodIndex != -1)
                {
                    splitIndex = periodIndex + 1;
                }
                else if (dotIndex != -1)
                {
                    splitIndex = dotIndex + 2;
                }
                else if (newlineIndex != -1)
                {
                    splitIndex = newlineIndex + 1;
                }

                if (splitIndex == -1)
                {
                    break; // 分割位置が見つからなければ終了
                }

                string segment = diff.Substring(0, splitIndex);
                // 音声合成キューに回す処理をここに追加
                MyLog.LogWrite($"音声合成キューに追加: {segment.Trim()}");
                queue.Enqueue(new SynthesisRequest
                {
                    MessageId = currentMessageId,
                    Text = segment.Trim()
                });

                currentMessageBuffer += segment;
            }

        }
        // 最終メッセージ
        public async Task CompleteAsync(string text)
        {
            // UUIDが設定されいなければ終わり
            // カレントバッファと比較し、差分を取得
            // 差分があれば音声合成キューに回す
            if (currentMessageId == Guid.Empty)
            {
                return;
            }

            string diff = text.Substring(currentMessageBuffer.Length);
            if (!string.IsNullOrEmpty(diff))
            {
                // 音声合成キューに回す処理をここに追加
                MyLog.LogWrite($"音声合成キューに追加: {diff.Trim()}");
                queue.Enqueue(new SynthesisRequest
                {
                    MessageId = currentMessageId,
                    Text = diff.Trim()
                });
            }
        }
    }
}