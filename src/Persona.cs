using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ImageMagick;

namespace CllDotnet
{
    public class Persona
    {
        private FileManager fileManager;
        private ConsoleMonitor consoleMonitor;
        private LLM llm;
        private DateTime lastGeneratedAt = DateTime.UtcNow; // 最後に生成を実行した時刻
        private int consecutiveTimerGenerations = 0; // 連続タイマー生成回数
        public Persona(FileManager fileManager, ConsoleMonitor consoleMonitor, LLM llm)
        {
            this.fileManager = fileManager;
            this.consoleMonitor = consoleMonitor;
            this.llm = llm;
            NotifyPersonaInfo();
        }

        public async Task PerformPeriodicTasks(CancellationToken cancellationToken)
        {
            var generalSettings = fileManager.generalSettings;

            // タイマー生成処理
            if (generalSettings.EnableTimerGenerate)
            {
                var activePersonaSettings = fileManager.GetActivePersonaSettings();
                if (activePersonaSettings.TimerCycleMinutes > 0)
                {
                    // 次の生成時刻を計算
                    var nextGeneratedAt = lastGeneratedAt.AddMinutes(activePersonaSettings.TimerCycleMinutes);

                    // 現在時刻が次の生成時刻を過ぎている場合、生成処理を実行
                    if (DateTime.UtcNow >= nextGeneratedAt)
                    {
                        // ただし、連続生成回数の制限に達した場合はスキップする
                        if (consecutiveTimerGenerations >= generalSettings.TimerGenerateLimitMax)
                        {
                            MyLog.LogWrite($"タイマー生成処理が連続{generalSettings.TimerGenerateLimitMax}回に達したため、スキップします。");
                            return;
                        }

                        // 生成処理中はスキップする
                        if (llm.IsGenerating())
                        {
                            MyLog.LogWrite("生成処理中のため、スキップします。");
                            return;
                        }

                        lastGeneratedAt = DateTime.UtcNow; // 最後の生成時刻を更新する
                        consecutiveTimerGenerations++;
                        MyLog.LogWrite($"タイマー生成処理を実行します {consecutiveTimerGenerations}回目 {activePersonaSettings.TimerCycleMinutes}分おき");

                        // タイマーメッセージをユーザーロールで挿入
                        string tt = $"<system>{fileManager.generalSettings.TimerGenerateMessage}</system>";
                        var entry = new TalkEntry
                        {
                            Uuid = Guid.Empty,
                            Role = TalkRole.ChocolateLM,
                            Text = tt,
                            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                            AttachmentId = null,
                            ToolDetail = "",
                            Reasoning = string.Empty,
                            Tokens = Tokens.CountTokens(tt)
                        };
                        var newGuid = await fileManager.WithTalkHistoryLock(async () =>
                        {
                            await Task.Delay(0);
                            return fileManager.UpsertTalkHistoryToActivePersona(entry);
                        }, cancellationToken);

                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                var success = await fileManager.WithTalkHistoryLock(async () =>
                                {
                                    if (!await llm!.GenerateResponseAsync())
                                    {
                                        // 生成失敗時は連続タイマー生成回数を上限にして中止
                                        consecutiveTimerGenerations = int.MaxValue;
                                    }
                                    return true;
                                }, cancellationToken);
                            }
                            catch (Exception e)
                            {
                                MyLog.LogWrite($"生成処理例外 {e.Message} {e.StackTrace}");
                            }
                        });
                    }
                }
            }
        }

        private void NotifyPersonaInfo()
        {
            // 現在のペルソナリスト[{id}:{name}, ...{id}:{name}]と、アクティブペルソナIDと名前をコンソールモニターに通知する
            var personas = fileManager.GetPersonaListWithNamesAndLastTimestamp();
            var active = fileManager.GetActivePersonaIdWithName();

            string personaInfo = $"{string.Join(", ", personas.ConvertAll(p => $"[{p.id}]{p.name}"))}";
            consoleMonitor?.UpdateInfo("ペルソナ", personaInfo);
            consoleMonitor?.UpdateInfo("アクティブペルソナ", $"[{active?.id.ToString() ?? "0"}]{active?.name ?? "なし"}");
        }

        public Dictionary<string, object> GetSettings()
        {
            var settings = fileManager.generalSettings;
            if (settings == null)
            {
                return new Dictionary<string, object>();
            }
            var clonedSettings = settings.ShallowCopy();
            clonedSettings.LlmApiKey = string.IsNullOrEmpty(settings.LlmApiKey) ? string.Empty : "************"; // APIキーは返さない
            clonedSettings.ImageGenerationApiKey = string.IsNullOrEmpty(settings.ImageGenerationApiKey) ? string.Empty : "************"; // 画像生成APIキーは返さない
            return new Dictionary<string, object>
            {
                { "settings", clonedSettings }
            };
        }

        public Dictionary<string, object> SetSettings(Dictionary<string, JsonElement> newSettings)
        {
            var settings = fileManager.generalSettings;
            if (settings == null)
            {
                return new Dictionary<string, object> { { "error", "一般設定の読み込みに失敗しました。" } };
            }

            // newSettingsの内容でsettingsを更新する
            foreach (var kvp in newSettings)
            {
                switch (kvp.Key)
                {
                    // --- 基本設定 ---
                    case "LlmEndpointUrl":
                        settings.LlmEndpointUrl = kvp.Value.GetString() ?? settings.LlmEndpointUrl;
                        break;
                    case "LlmApiKey":
                        var v = kvp.Value.GetString();
                        if( v==null || v.StartsWith("**"))
                        {
                            // 変更なし
                            break;
                        }
                        settings.LlmApiKey = v ?? settings.LlmApiKey;
                        break;
                    case "DefaultModel":
                        settings.DefaultModel = kvp.Value.GetString() ?? settings.DefaultModel;
                        break;
                    case "YourName":
                        settings.YourName = kvp.Value.GetString() ?? settings.YourName;
                        break;
                    case "BreakReminderThreshold":
                        settings.BreakReminderThreshold = kvp.Value.GetInt32();
                        break;
                    case "TalkHistoryCutoffThreshold":
                        settings.TalkHistoryCutoffThreshold = kvp.Value.GetInt32();
                        break;
                    case "LocalOnly":
                        settings.LocalOnly = kvp.Value.GetBoolean();
                        break;

                    // --- 応用設定 ---
                    case "TimeoutSeconds":
                        settings.TimeoutSeconds = kvp.Value.GetInt32();
                        break;
                    case "Temperature":
                        settings.Temperature = kvp.Value.GetDouble();
                        break;
                    case "MaxTokens":
                        settings.MaxTokens = kvp.Value.GetInt32();
                        break;
                    case "TimerGenerateLimitMax":
                        settings.TimerGenerateLimitMax = kvp.Value.GetInt32();
                        break;
                    case "PhotoCutoff":
                        settings.PhotoCutoff = kvp.Value.GetInt32();
                        break;
                    case "TimerGenerateMessage":
                        settings.TimerGenerateMessage = kvp.Value.GetString() ?? settings.TimerGenerateMessage;
                        break;
                    case "TimeZone":
                        settings.TimeZone = kvp.Value.GetString() ?? settings.TimeZone;
                        break;
                    case "HttpPort":
                        settings.HttpPort = kvp.Value.GetInt32();
                        break;

                    case "EnableHowto":
                        settings.EnableHowto = kvp.Value.GetBoolean();
                        break;
                    case "EnableMemory":
                        settings.EnableMemory = kvp.Value.GetBoolean();
                        break;
                    case "EnableJavascript":
                        settings.EnableJavascript = kvp.Value.GetBoolean();
                        break;
                    case "EnableProject":
                        settings.EnableProject = kvp.Value.GetBoolean();
                        break;
                    case "EnableTimestamps":
                        settings.EnableTimestamps = kvp.Value.GetBoolean();
                        break;
                    case "EnableCurrentTime":
                        settings.EnableCurrentTime = kvp.Value.GetBoolean();
                        break;
                    case "EnableStatisticsAndBreakReminder":
                        settings.EnableStatisticsAndBreakReminder = kvp.Value.GetBoolean();
                        break;
                    case "EnableWebhook":
                        settings.EnableWebhook = kvp.Value.GetBoolean();
                        break;
                    case "EnableAutoUpdateCheck":
                        settings.EnableAutoUpdateCheck = kvp.Value.GetBoolean();
                        break;
                    case "EnableConsoleMonitor":
                        settings.EnableConsoleMonitor = kvp.Value.GetBoolean();
                        break;
                    case "DebugMode":
                        settings.DebugMode = kvp.Value.GetBoolean();
                        break;
                    case "EnableTimerGenerate":
                        settings.EnableTimerGenerate = kvp.Value.GetBoolean();
                        break;
                    case "EnableMcpTools":
                        settings.EnableMcpTools = kvp.Value.GetBoolean();
                        break;
                    case "SystemSettingsLocalOnly":
                        settings.SystemSettingsLocalOnly = kvp.Value.GetBoolean();
                        break;
                    case "EnableImageGeneration":
                        settings.EnableImageGeneration = kvp.Value.GetBoolean();
                        break;
                    case "ImageGenerationEndpointUrl":
                        settings.ImageGenerationEndpointUrl = kvp.Value.GetString() ?? settings.ImageGenerationEndpointUrl;
                        break;
                    case "ImageGenerationApiKey":
                        var imageKey = kvp.Value.GetString();
                        if (imageKey == null || imageKey.StartsWith("**"))
                        {
                            break;
                        }
                        settings.ImageGenerationApiKey = imageKey ?? settings.ImageGenerationApiKey;
                        break;
                    case "ImageGenerationModel":
                        settings.ImageGenerationModel = kvp.Value.GetString() ?? settings.ImageGenerationModel;
                        break;
                    default:
                        // 未知のキーは無視する
                        MyLog.LogWrite($"不明な一般設定キー: {kvp.Key}");
                        break;
                }
            }

            // 設定を保存する
            fileManager.SaveGeneralSettings(settings);

            return new Dictionary<string, object> { { "success", "done" } };
        }

        public Dictionary<string, object> GetPersonas()
        {
            NotifyPersonaInfo();
            var personasRaw = fileManager.GetPersonaListWithNamesAndLastTimestamp();
            var activeId = fileManager.GetActivePersonaId() ?? 0;

            var personas = new List<Dictionary<string, object>>();
            foreach (var (id, name, timestamp) in personasRaw)
            {
                personas.Add(new Dictionary<string, object>
                {
                    { "id", id },
                    { "name", name },
                    { "timestamp", timestamp }
                });
            }
            return new Dictionary<string, object> { { "personas", personas }, { "count", personas.Count }, { "active", activeId } };
        }
        public Dictionary<string, object> NewPersona(string name)
        {
            var result = new Dictionary<string, object>();
            var id = fileManager.CreateNewPersona(name);
            if (id != null)
            {
                result["id"] = id;
            }
            else
            {
                result["error"] = "ペルソナの作成に失敗しました。";
            }
            return result;
        }
        public Dictionary<string, object> RemovePersona(int id)
        {
            llm?.CancelGeneration();

            var result = new Dictionary<string, object>();
            fileManager.RemovePersonaById(id);
            result["success"] = "done";
            return result;
        }

        public Dictionary<string, object> DuplicatePersona(int id, string? newName = null)
        {
            var result = new Dictionary<string, object>();
            var newId = fileManager.DuplicatePersonaById(id, newName);
            if (newId != 0)
            {
                result["id"] = newId;
            }
            else
            {
                result["error"] = "ペルソナの複製に失敗しました。";
            }
            return result;
        }

        // ---

        public Dictionary<string, object> GetActivePersona()
        {
            var activeId = fileManager.GetActivePersonaId();
            var result = new Dictionary<string, object>();
            if (activeId != null)
            {
                result["id"] = activeId;
            }
            else
            {
                // アクティブなペルソナが設定されていないのは正常
                result["id"] = 0;
            }
            return result;
        }
        public Dictionary<string, object> SetActivePersona(int id)
        {
            llm?.CancelGeneration();

            var result = new Dictionary<string, object>();
            var success = fileManager.SetActivePersonaById(id);
            if (success)
            {
                NotifyPersonaInfo();
                result["id"] = id;
            }
            else
            {
                result["error"] = "指定されたIDのペルソナが存在しません。";
            }
            return result;
        }

        // ---

        public Dictionary<string, object> GetActivePersonaAttachments()
        {
            var result = new Dictionary<string, object>();
            var attachmentIds = fileManager.GetAttachmentList();
            result["attachments"] = attachmentIds;
            return result;
        }
        public Dictionary<string, object> UploadActivePersonaAttachment(string filename, byte[] data)
        {
            var result = new Dictionary<string, object>();

            // 危険な拡張子は処理を中止する
            if (DangerousChecker.IsDangerousFileName(filename))
            {
                result["error"] = "許可されていないファイル形式です。";
                return result;
            }

            // 画像データなので1024x1024未満にリサイズする。
            try
            {
                using (var image = new MagickImage(data))
                {
                    if (image.Width > 1024 || image.Height > 1024)
                    {
                        image.Resize(new MagickGeometry
                        {
                            Width = 1024,
                            Height = 1024,
                            IgnoreAspectRatio = false,
                            Greater = true
                        });

                        using (var ms = new MemoryStream())
                        {
                            image.Format = MagickFormat.Png;
                            image.Write(ms);
                            data = ms.ToArray();
                            filename = Path.ChangeExtension(filename, ".png");
                        }
                    }
                }
            }
            catch (MagickException)
            {
                result["error"] = "画像の処理に失敗しました。";
                return result;
            }

            var id = fileManager.SaveAttachmentToActivePersona(filename, data);
            if (id != null)
            {
                result["id"] = id;
            }
            else
            {
                result["error"] = "添付ファイルの保存に失敗しました。";
            }
            return result;
        }
        public (string filename, byte[] data)? GetActivePersonaAttachmentById(int id)
        {
            // 危険な拡張子は処理を中止する
            var ret = fileManager.GetAttachmentFromActivePersona(id);
            if (ret == null)
            {
                return null;
            }
            if (DangerousChecker.IsDangerousFileName(ret.Value.filename))
            {
                return null;
            }

            return ret;
        }

        // ---

        public byte[] GetActivePersonaFile(string filename)
        {
            // user.png, assistant.png, background.pngのみ許容する。
            if (filename != "user.png" && filename != "assistant.png" && filename != "background.png")
            {
                return Array.Empty<byte>();
            }
            var fileData = fileManager.GetFileContentFromActivePersona(filename);
            if (fileData != null)
            {
                return fileData;
            }
            return Array.Empty<byte>();
        }

        public Dictionary<string, object> UploadActivePersonaFile(string filename, byte[] data)
        {
            var result = new Dictionary<string, object>();
            // user.*, assistant.*, background.*のみ許容する。
            var name = Path.GetFileNameWithoutExtension(filename);
            if (name != "user" && name != "assistant" && name != "background")
            {
                result["error"] = "許可されていないファイル名です。";
                return result;
            }

            // pngでない場合はpngに変換する。
            try
            {
                using (var image = new MagickImage(data))
                {
                    if (image.Width > 2048 || image.Height > 2048)
                    {
                        image.Resize(new MagickGeometry
                        {
                            Width = 2048,
                            Height = 2048,
                            IgnoreAspectRatio = false,
                            Greater = true
                        });
                    }

                    using (var ms = new MemoryStream())
                    {
                        image.Format = MagickFormat.Png;
                        image.Write(ms);
                        data = ms.ToArray();
                        filename = Path.ChangeExtension(filename, ".png");
                    }
                }
            }
            catch (MagickException)
            {
                result["error"] = "画像の処理に失敗しました。";
                return result;
            }

            var success = fileManager.SaveFileContentToActivePersona(filename, data);
            if (success)
            {
                result["success"] = "done";
            }
            else
            {
                result["error"] = "ファイルの保存に失敗しました。";
            }
            return result;
        }

        // ---

        public async Task<Dictionary<string, object>> GetActivePersonaMessages(int index, int count, CancellationToken cancellationToken)
        {
            await Task.Delay(0);
            var (messages, total) = fileManager.GetTalkHistoryFromActivePersona(index, count);

            var stats = fileManager.GetTalkStatsFromActivePersona() ?? new TalkStats();

            // messagesの内容のMD5ハッシュを計算して返す
            var messagesJson = Serializer.JsonSerialize(messages, false);
            using var md5 = System.Security.Cryptography.MD5.Create();
            var hash = md5.ComputeHash(Encoding.UTF8.GetBytes(messagesJson));
            var hashString = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();

            return new Dictionary<string, object>
            {
                ["messages"] = messages,
                ["hash"] = hashString,
                ["total"] = total,
                ["stats"] = stats
            };
        }

        public async Task<Dictionary<string, object>> UpsertActivePersonaMessage(Dictionary<string, JsonElement> json, CancellationToken cancellationToken)
        {
            // AI生成処理中は拒否する
            if (llm.IsGenerating())
            {
                MyLog.LogWrite("AI生成処理中のため、新しいメッセージの追加・更新を拒否しました。");
                return new Dictionary<string, object> { { "error", "現在AI生成処理中のため、新しいメッセージの追加・更新はできません。" } };
            }

            string? uuid = null;
            if (json.ContainsKey("Uuid"))
            {
                // UUIDが存在する場合は更新処理になる
                uuid = json["Uuid"].GetString();
            }

            // UUIDとして正しい形式か確認する
            Guid guid = Guid.Empty;
            if (uuid != null && !Guid.TryParse(uuid, out guid))
            {
                return new Dictionary<string, object> { { "error", "uuidパラメーターの形式が不正です。" } };
            }

            var content = new Dictionary<string, JsonElement>(json);

            // jsonをTalkEntryに変換する
            var entry = ToTalkEntry(content, guid);

            // トーク履歴に追加・更新する
            var newGuid = await fileManager.WithTalkHistoryLock(async () =>
            {
                await Task.Delay(0);
                return fileManager.UpsertTalkHistoryToActivePersona(entry);
            }, cancellationToken);

            if (newGuid != Guid.Empty)
            {
                // AI生成処理を開始する
                consecutiveTimerGenerations = 0; // 連続タイマー生成回数をリセットする(ユーザー操作による生成なので)
                lastGeneratedAt = DateTime.UtcNow; // 最後の生成時刻を更新する

                _ = Task.Run(async () =>
                {
                    try
                    {
                        _ = await fileManager.WithTalkHistoryLock(async () =>
                        {
                            if (!await llm!.GenerateResponseAsync())
                            {
                                // 生成失敗時は連続タイマー生成回数を上限にして中止
                                consecutiveTimerGenerations = int.MaxValue;
                            }
                            return true;
                        }, cancellationToken);
                    }
                    catch (Exception e)
                    {
                        MyLog.LogWrite($"生成処理例外 {e.Message} {e.StackTrace}");
                    }
                });

                await Task.Delay(0);
                return new Dictionary<string, object> { { "success", "done" }, { "uuid", entry.Uuid } };
            }
            else
            {
                return new Dictionary<string, object> { { "error", "メッセージの更新に失敗しました。(そのUUIDは存在しません)" } };
            }
        }

        public Dictionary<string, object> CancelActivePersonaMessageGeneration()
        {
            // AI生成処理をキャンセルする
            llm.CancelGeneration();
            return new Dictionary<string, object> { { "success", "done" } };
        }

        // ---

        public Dictionary<string, object> SetActivePersonaSettings(Dictionary<string, JsonElement> content)
        {
            // nameとsystem_promptを抽出して保存する
            var personaSettings = fileManager.GetActivePersonaSettings();

            if (content.ContainsKey("name") && content["name"].ValueKind == JsonValueKind.String)
            {
                personaSettings.Name = content["name"].GetString() ?? "";
            }

            if (content.ContainsKey("model") && content["model"].ValueKind == JsonValueKind.String)
            {
                personaSettings.Model = content["model"].GetString() ?? "";
            }
            if (content.ContainsKey("timer_cycle_minutes") && content["timer_cycle_minutes"].ValueKind == JsonValueKind.Number)
            {
                personaSettings.TimerCycleMinutes = content["timer_cycle_minutes"].GetInt32();
            }
            if (content.ContainsKey("webhook_url") && content["webhook_url"].ValueKind == JsonValueKind.String)
            {
                personaSettings.WebhookUrl = content["webhook_url"].GetString() ?? "";
            }
            if (content.ContainsKey("webhook_body") && content["webhook_body"].ValueKind == JsonValueKind.String)
            {
                personaSettings.WebhookBody = content["webhook_body"].GetString() ?? "";
            }

            fileManager.SaveActivePersonaSettings(personaSettings);

            if (content.ContainsKey("system_prompt") && content["system_prompt"].ValueKind == JsonValueKind.String)
            {
                var systemPromptValue = content["system_prompt"].GetString() ?? "";
                fileManager.SaveSystemPromptToActivePersona(systemPromptValue);
            }
            return new Dictionary<string, object> { { "success", "done" } };
        }
        public Dictionary<string, object> GetActivePersonaSettings()
        {
            var settings = fileManager.GetActivePersonaSettings();
            var system_prompt = fileManager.GetSystemPromptFromActivePersona();

            // YAMLからname, plain textからsystem_promptを抽出して返す
            var result = new Dictionary<string, object>();
            if (settings != null)
            {
                result["name"] = settings.Name;
                result["model"] = settings.Model;
                result["timer_cycle_minutes"] = settings.TimerCycleMinutes;
                result["webhook_url"] = settings.WebhookUrl;
                result["webhook_body"] = settings.WebhookBody;
                result["system_prompt"] = system_prompt ?? "";
            }
            return result;
        }

        public Dictionary<string, object> GetActivePersonaMemory()
        {
            var memory = fileManager.GetActivePersonaMemory();
            return new Dictionary<string, object>
            {
                { "memory_entries", memory.MemoryEntries },
                { "count", memory.MemoryEntries.Count }
            };
        }

        private TalkEntry ToTalkEntry(Dictionary<string, JsonElement> content, Guid existingUuid)
        {
            var entry = new TalkEntry
            {
                Uuid = existingUuid,
                Role = TalkRole.Unknown,
                Text = string.Empty,
                ToolDetail = string.Empty,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                AttachmentId = null,
                Reasoning = string.Empty,
                Tokens = 0
            };

            if (content.TryGetValue("Role", out var roleValue))
            {
                var roleText = roleValue.ToString();
                if (!string.IsNullOrWhiteSpace(roleText) && Enum.TryParse(roleText, true, out TalkRole parsedRole))
                {
                    entry.Role = parsedRole;
                }
            }

            if (content.TryGetValue("Text", out var textValue))
            {
                entry.Text = textValue.ToString();
            }

            if (content.TryGetValue("AttachmentId", out var attachmentValue))
            {
                if (attachmentValue is JsonElement jsonElement && jsonElement.ValueKind == JsonValueKind.Array)
                {
                    var attachmentIds = new List<int>();
                    foreach (var item in jsonElement.EnumerateArray())
                    {
                        if (item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out int id))
                        {
                            attachmentIds.Add(id);
                        }
                    }
                    entry.AttachmentId = attachmentIds;
                }
            }

            if (content.TryGetValue("Timestamp", out var timestampValue))
            {
                var timestampText = timestampValue.ToString();
                if (long.TryParse(timestampText, out long parsedTimestamp))
                {
                    entry.Timestamp = parsedTimestamp;
                }
            }

            if (content.TryGetValue("ToolDetail", out var toolDetailValue))
            {
                entry.ToolDetail = toolDetailValue.ToString();
            }
            return entry;
        }
    }
}