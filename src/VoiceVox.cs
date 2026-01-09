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
using System.Text.Json.Nodes;
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
        string currentMessageBuffer = "";
        Guid currentMessageId = Guid.Empty;
        ConcurrentQueue<SynthesisRequest> queue = new();

        class SynthesisRequest
        {
            public Guid MessageId = Guid.Empty;
            public string Text = "";
            public int TailIndex = -1;
            public string VoiceVoxBaseUrl = "";
            public bool EnableKatakanaEnglish = true;
            public bool EnableInterrogativeUpspeak = true;
            public int SpeakerId = -1;
            public double? SpeedScale = null;
            public double? PitchScale = null;
            public double? IntonationScale = null;
            public double? VolumeScale = null;
            public double? PrePhonemeLength = null;
            public double? PostPhonemeLength = null;
            public double? PauseLength = null;
            public double? PauseLengthScale = null;
            public bool Finished = false;
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

        private string GetVoiceVoxBaseUrl()
        {
            var configured = _fileManager.generalSettings?.VoiceVoxBaseUrl?.Trim();
            if (!string.IsNullOrWhiteSpace(configured) &&
                Uri.TryCreate(configured, UriKind.Absolute, out var uri) &&
                (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            {
                return uri.ToString();
            }
            return "";
        }

        // 音声合成キューに追加(表示同期用にIndexも渡す)
        private void EnqueueSpeech(string text, int startIndex, string extractMode, bool finished = false)
        {
            string originalText = text;

            if (extractMode == "remove_brackets")
            {
                // ()内を除去する
                text = Regex.Replace(text, @"\([^()]*\)", "");
                text = Regex.Replace(text, @"\（[^（）]*\）", "");
            }else if (extractMode == "say_tag")
            {
                // <say>タグを抽出する
                var match = Regex.Match(text, @"<say>(.*?)</say>");
                if (match.Success)
                {
                    text = match.Groups[1].Value;
                }else{
                    // 見つからなければ空文字にする
                    text = "";
                }
            }else if (extractMode == "quotation_mark")
            {
                // 「」を抽出する
                var match = Regex.Match(text, @"「(.*?)」");
                if (match.Success)
                {
                    text = match.Groups[1].Value;
                }else{
                    // 見つからなければ空文字にする
                    text = "";
                }
            }else{
                // 何もしない
            }
            
            if (string.IsNullOrWhiteSpace(text))
            {
                return;
            }
            var personaSettings = _fileManager.GetActivePersonaSettings();
            if (personaSettings == null || personaSettings.VoiceVoxSpeakerId == -1)
            {
                return;
            }

            // 改行や。で分割してキューに追加する。(長すぎると失敗するため)
            var splitText = text.Split(new[] { "。", ". ", "\n" }, StringSplitOptions.RemoveEmptyEntries);
            for(int i = 0; i < splitText.Length; i++)
            {
                int tailIndex = startIndex + originalText.IndexOf(splitText[i]) + splitText[i].Length + 1;
                var trimmedSegment = splitText[i].Trim().Replace("**", "");
                bool lastFinished = finished && (i == splitText.Length -1);

                if (!string.IsNullOrEmpty(trimmedSegment))
                {
                    MyLog.LogWrite($"音声合成キューに追加: {text} / {currentMessageId} / {GetVoiceVoxBaseUrl()}" +
                    $"(Speaker ID: {personaSettings.VoiceVoxSpeakerId}, Speed: {personaSettings.VoiceVoxSpeedScale}, Pitch: {personaSettings.VoiceVoxPitchScale}" +
                    $", Intonation: {personaSettings.VoiceVoxIntonationScale}, Volume: {personaSettings.VoiceVoxVolumeScale}" +
                    $", PrePhoneme: {personaSettings.VoiceVoxPrePhonemeLength}, PostPhoneme: {personaSettings.VoiceVoxPostPhonemeLength}" +
                    $", PauseLength: {personaSettings.VoiceVoxPauseLength}, PauseLengthScale: {personaSettings.VoiceVoxPauseLengthScale})");
                    queue.Enqueue(new SynthesisRequest
                    {
                        VoiceVoxBaseUrl = GetVoiceVoxBaseUrl(),
                        Text = trimmedSegment,
                        MessageId = currentMessageId,
                        SpeakerId = personaSettings.VoiceVoxSpeakerId,
                        SpeedScale = personaSettings.VoiceVoxSpeedScale,
                        PitchScale = personaSettings.VoiceVoxPitchScale,
                        IntonationScale = personaSettings.VoiceVoxIntonationScale,
                        VolumeScale = personaSettings.VoiceVoxVolumeScale,
                        PrePhonemeLength = personaSettings.VoiceVoxPrePhonemeLength,
                        PostPhonemeLength = personaSettings.VoiceVoxPostPhonemeLength,
                        PauseLength = personaSettings.VoiceVoxPauseLength,
                        PauseLengthScale = personaSettings.VoiceVoxPauseLengthScale,
                        TailIndex = tailIndex,
                        Finished = lastFinished,
                    });
                }
            }
        }

        private async Task CheckBufferAsync()
        {
            while (queue.TryDequeue(out var request))
            {
                try
                {
                    MyLog.LogWrite($"音声合成開始: {request.Text}");
                    var audioData = await CreateSpeechAsync(request, _cts);
                    if (audioData.Length > 0)
                    {
                        string data = Convert.ToBase64String(audioData);
                        await Broadcaster.Broadcast(new Dictionary<string, object> { { "speak", data }, { "messageId", request.MessageId.ToString() }, { "tailIndex", request.TailIndex }, { "finished", request.Finished } });
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

        private async Task<byte[]> CreateSpeechAsync(SynthesisRequest request, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(request.Text))
            {
                return Array.Empty<byte>();
            }

            using var HttpClient = new HttpClient { BaseAddress = new Uri(request.VoiceVoxBaseUrl) };

            var queryUrl = $"/audio_query?text={Uri.EscapeDataString(request.Text)}&speaker={request.SpeakerId}&enable_katakana_english={request.EnableKatakanaEnglish.ToString().ToLowerInvariant()}";
            using var audioQueryResponse = await HttpClient.PostAsync(queryUrl, content: null, cancellationToken);
            audioQueryResponse.EnsureSuccessStatusCode();

            var audioQueryJson = await audioQueryResponse.Content.ReadAsStringAsync(cancellationToken);
            var audioQueryObject = JsonSerializer.Deserialize<JsonObject>(audioQueryJson) ?? new JsonObject();

            void SetIfSpecified(string propertyName, double? value)
            {
                if (value.HasValue)
                {
                    audioQueryObject[propertyName] = value.Value;
                }
            }

            SetIfSpecified("speedScale", request.SpeedScale);
            SetIfSpecified("pitchScale", request.PitchScale);
            SetIfSpecified("intonationScale", request.IntonationScale);
            SetIfSpecified("volumeScale", request.VolumeScale);
            SetIfSpecified("prePhonemeLength", request.PrePhonemeLength);
            SetIfSpecified("postPhonemeLength", request.PostPhonemeLength);
            SetIfSpecified("pauseLength", request.PauseLength);
            SetIfSpecified("pauseLengthScale", request.PauseLengthScale);

            var updatedAudioQueryJson = audioQueryObject.ToJsonString();
            using var audioQueryContent = new StringContent(updatedAudioQueryJson, System.Text.Encoding.UTF8, "application/json");

            var synthesisUrl = $"/synthesis?speaker={request.SpeakerId}&enable_interrogative_upspeak={request.EnableInterrogativeUpspeak.ToString().ToLowerInvariant()}";
            using var synthesisResponse = await HttpClient.PostAsync(synthesisUrl, audioQueryContent, cancellationToken);
            synthesisResponse.EnsureSuccessStatusCode();

            return await synthesisResponse.Content.ReadAsByteArrayAsync(cancellationToken);
        }

        public class Speaker
        {
            public string Name { get; set; } = string.Empty;
            public string StyleName { get; set; } = string.Empty;
            public int SpeakerId { get; set; }
        }

        public async Task<Dictionary<string, object>> GetAvailableSpeakersAsync()
        {
            var speakers = new List<Speaker>();

            try
            {
                var baseUrl = GetVoiceVoxBaseUrl();
                if(string.IsNullOrWhiteSpace(baseUrl))
                {
                    return new Dictionary<string, object>();
                }
                using var httpClient = new HttpClient { BaseAddress = new Uri(baseUrl) };
                using var response = await httpClient.GetAsync("/speakers", _cts);
                response.EnsureSuccessStatusCode();

                var json = await response.Content.ReadAsStringAsync(_cts);
                var speakerArray = JsonSerializer.Deserialize<JsonArray>(json);
                if (speakerArray is null)
                {
                    return new Dictionary<string, object>();
                }

                foreach (var speakerNode in speakerArray)
                {
                    if (speakerNode is not JsonObject speakerObj)
                    {
                        continue;
                    }

                    var name = speakerObj["name"]?.GetValue<string>();
                    if (string.IsNullOrWhiteSpace(name))
                    {
                        continue;
                    }

                    if (speakerObj["styles"] is not JsonArray stylesArray)
                    {
                        continue;
                    }

                    foreach (var styleNode in stylesArray)
                    {
                        if (styleNode is not JsonObject styleObj)
                        {
                            continue;
                        }

                        var styleName = styleObj["name"]?.GetValue<string>();
                        var styleId = styleObj["id"]?.GetValue<int>();
                        if (string.IsNullOrWhiteSpace(styleName) || styleId is null)
                        {
                            continue;
                        }

                        speakers.Add(new Speaker
                        {
                            Name = name,
                            StyleName = styleName,
                            SpeakerId = styleId.Value
                        });
                    }
                }

                // 話者名とスタイル名を組み合わせた辞書を作成
                var speakerDict = new Dictionary<string, object>();
                foreach (var speaker in speakers)
                {
                    var key = $"{speaker.Name} - {speaker.StyleName}";
                    speakerDict[key] = speaker.SpeakerId;
                }
                return speakerDict;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                MyLog.LogWrite($"話者一覧取得に失敗: {ex.Message} {ex.StackTrace}");
            }

            return new Dictionary<string, object>();
        }

        // 新しいメッセージの開始
        public async Task InitializeAsync()
        {
            currentMessageBuffer = "";
            currentMessageId = Guid.NewGuid();
            MyLog.LogWrite($"音声合成初期化: {currentMessageId}");
        }

        // 強制中止
        public async Task CancelAsync()
        {
            // キューはクリアする。バッファはクリアしない。(後続の生成完了処理で無視するため)
            queue.Clear();
            MyLog.LogWrite($"音声合成キャンセル: {currentMessageId}");
        }

        // 中間メッセージ
        public async Task ProgressAsync(string text)
        {
            // UUIDが設定されいなければ終わり
            if (currentMessageId == Guid.Empty)
            {
                return;
            }

            var extractMode = _fileManager.GetActivePersonaSettings()?.VoiceVoxExtractMode ?? "none";

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
                int sayCloseIndex = diff.IndexOf("</say>");
                int quoteCloseIndex = diff.IndexOf("」");
                int parenCloseIndex = diff.IndexOf(")");
                int paren2CloseIndex = diff.IndexOf('）');

                int splitIndex = -1;

                if (extractMode == "say_tag")
                {
                    // saytagモード(</say>を区切り箇所として抽出する)
                    if (sayCloseIndex >= 0)
                    {
                        splitIndex = sayCloseIndex + 6; // "</say>"の長さは6
                    }
                }
                else if (extractMode == "quotation_mark")
                {
                    // 引用符モード(」を区切り箇所として抽出する)
                    if (quoteCloseIndex >= 0)
                    {
                        splitIndex = quoteCloseIndex + 1;
                    }
                }
                else if (extractMode == "remove_brackets")
                {
                    // 括弧除去モード())を区切り箇所として抽出する
                    if (parenCloseIndex >= 0)
                    {
                        splitIndex = parenCloseIndex + 1;
                    }
                    if (paren2CloseIndex >= 0)
                    {
                        splitIndex = paren2CloseIndex + 1;
                    }
                }
                else
                {
                    // 通常モード(文末を区切り箇所として抽出する)
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
                }

                if (splitIndex == -1)
                {
                    break; // 分割位置が見つからなければ終了
                }

                string segment = diff.Substring(0, splitIndex);
                int startIndex = currentMessageBuffer.Length;

                // 音声合成キューに回す処理をここに追加                
                EnqueueSpeech(segment, startIndex, extractMode);

                currentMessageBuffer += segment;
                MyLog.LogWrite($"音声合成中間処理: {currentMessageId} / バッファ長: {currentMessageBuffer.Length} / splitIndex: {splitIndex}");
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
                var extractMode = _fileManager.GetActivePersonaSettings()?.VoiceVoxExtractMode ?? "none";
                EnqueueSpeech(diff, currentMessageBuffer.Length, extractMode, finished: true);
            }
        }
    }
}