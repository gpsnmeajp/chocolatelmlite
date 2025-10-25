using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace CllDotnet
{
    public class YamlPersona
    {
        public string Name { get; set; } = "名称未設定";
        public string Model { get; set; } = "";
        public int TimerCycleMinutes { get; set; } = 0;
        public string WebhookUrl { get; set; } = "";
        public string WebhookBody { get; set; } = "{\"content\":\"%text%\"}";
    }

    public class YamlMemory
    {
        public List<YamlMemoryEntry> MemoryEntries { get; set; } = new List<YamlMemoryEntry>();
    }

    public class YamlMemoryEntry
    {
        public int Id { get; set; } = 0;
        public string Text { get; set; } = "";
        public string CreatedAt { get; set; } = "";
        public string UpdatedAt { get; set; } = "";
    }

    public class YamlManage
    {
        public int ActivePersonaId { get; set; } = 0;
    }

    public class YamlGeneral
    {
        // --- 基本設定 ---
        public string LlmEndpointUrl { get; set; } = "";
        public string LlmApiKey { get; set; } = "";
        public string DefaultModel { get; set; } = "google/gemini-2.5-flash";
        public string YourName { get; set; } = "あなた";
        public int BreakReminderThreshold { get; set; } = 60;
        public int TalkHistoryCutoffThreshold { get; set; } = 40 * 1000; //40Kトークン
        public bool LocalOnly { get; set; } = false;

        //--- 応用設定 ---
        public int TimeoutSeconds { get; set; } = 180;
        public double Temperature { get; set; } = 0.7;
        public int MaxTokens { get; set; } = 8192;
        public int TimerGenerateLimitMax { get; set; } = 30;
        public string TimerGenerateMessage { get; set; } = "タイマーイベント: 自由に独り言を言ったり、ツールを呼び出したりすることが出来ます。";
        public string TimeZone { get; set; } = "Asia/Tokyo";
        public int HttpPort { get; set; } = 8010;
        public bool SystemSettingsLocalOnly { get; set; } = true; 

        public bool EnableHowto { get; set; } = true;
        public bool EnableMemory { get; set; } = true;
        public bool EnableJavascript { get; set; } = true;
        public bool EnableProject { get; set; } = true;
        public bool EnableTimestamps { get; set; } = true;
        public bool EnableCurrentTime { get; set; } = true;
        public bool EnableStatisticsAndBreakReminder { get; set; } = true;
        public bool EnableWebhook { get; set; } = false;
        public bool EnableAutoUpdateCheck { get; set; } = true;
        public bool EnableConsoleMonitor { get; set; } = true;
        public bool EnableTimerGenerate { get; set; } = false;
        public bool EnableMcpTools { get; set; } = false;
        public int PhotoCutoff { get; set; } = 10;
        public bool EnableImageGeneration { get; set; } = false;
        public string ImageGenerationEndpointUrl { get; set; } = "";
        public string ImageGenerationApiKey { get; set; } = "";
        public string ImageGenerationModel { get; set; } = "google/gemini-2.5-flash-image";
        public bool DebugMode { get; set; } = false;


        public YamlGeneral ShallowCopy()
        {
            return (YamlGeneral)MemberwiseClone();
        }
    }

    public enum TalkRole
    {
        System,
        User,
        Assistant,
        Tool,
        ChocolateLM,
        Unknown
    }

    public class TalkEntry
    {
        public Guid Uuid { get; set; } = Guid.Empty;
        public TalkRole Role { get; set; } = TalkRole.Unknown;
        public string Text { get; set; } = "";
        public string Reasoning { get; set; } = "";
        public string ToolDetail { get; set; } = "";
        public List<int>? AttachmentId { get; set; } = null;
        public long Timestamp { get; set; } = 0;
    }

    public class TalkStats
    {
        public int Total { get; set; } = 0;
        public int Archived { get; set; } = 0;
        public int UserLast8h { get; set; } = 0;
        public bool NeedUserRestRemind { get; set; } = false;
        public int TotalTokens { get; set; } = 0;
        public int RawSystemPromptTokens { get; set; } = 0;
        public int BuiltSystemPromptTokens { get; set; } = 0;
    }

    public class FileManager
    {
        private readonly string dataDirectory = "data";
        private readonly string attachmentsDirectory = "attachments";
        private readonly string personaPrefix = "persona_";
        private readonly string attachmentPrefix = "attachment_";

        private readonly string settingsFilename = "settings.yaml";
        private readonly string manageFilename = "manage.yaml";
        private readonly string systemPromptFilename = "system_prompt.txt";
        private readonly string talkJsonlFilename = "talk.jsonl";
        private readonly string memoryFilename = "memory.yaml";
        private readonly string mcpJsonFilename = "mcp.json";

        // アプリケーション全体から参照される全体設定
        public YamlGeneral generalSettings { get; private set; }

        private List<TalkEntry> activePersonaTalkEntriesCache = new List<TalkEntry>();

        // ディレクトリを再帰的にコピーする
        public static void CopyDirectory(string sourceDir, string destDir)
        {
            MyLog.LogWrite($"{sourceDir} -> {destDir}");
            Directory.CreateDirectory(destDir);
            foreach (var file in Directory.GetFiles(sourceDir))
            {
                var destFile = Path.Combine(destDir, Path.GetFileName(file));
                File.Copy(file, destFile);
            }
            foreach (var directory in Directory.GetDirectories(sourceDir))
            {
                var destSubDir = Path.Combine(destDir, Path.GetFileName(directory));
                CopyDirectory(directory, destSubDir);
            }
        }

        public FileManager()
        {
            RemoveAllLockFiles();
            // general.yamlが存在しなければ初期値で作成
            var generalPath = Path.Combine(dataDirectory, "general.yaml");
            if (!File.Exists(generalPath))
            {
                var general = new YamlGeneral();
                SaveYaml(general, generalPath);
                MyLog.LogWrite($"general.yamlが存在しないため初期値で作成しました");
            }

            // general.yamlを読み込んで保持
            generalSettings = LoadGeneralSettings();

            // talk.jsonlの内容をキャッシュに読み込む
            var activeId = GetActivePersonaId();
            if (activeId != null)
            {
                activePersonaTalkEntriesCache = GetAllTalkHistoryAllFromActivePersona();
            }
        }

        // data配下のロックファイルを再帰的に削除
        public void RemoveAllLockFiles()
        {
            if (Directory.Exists(dataDirectory))
            {
                var lockFiles = Directory.GetFiles(dataDirectory, "*.lock", SearchOption.AllDirectories);
                foreach (var lockFile in lockFiles)
                {
                    MyLog.LogWrite($"ロックファイルを削除: {lockFile}");
                    File.Delete(lockFile);
                }
            }
        }

        private string GetPersonaDirectoryById(int id)
        {
            return Path.Combine(dataDirectory, $"{personaPrefix}{id}");
        }

        // YAMLの存在を確認し、存在しなければ新規作成。デシリアライズ失敗しても新規作成。成功すれば返す
        private T LoadYamlOrCreateNew<T>(string filePath) where T : new()
        {
            if (File.Exists(filePath))
            {
                var yaml = File.ReadAllText(filePath);
                var deserializer = new YamlDotNet.Serialization.Deserializer();
                try
                {
                    var obj = deserializer.Deserialize<T>(yaml);
                    if (obj != null)
                    {
                        return obj;
                    }
                }
                catch
                {
                    // デシリアライズ失敗時は新規作成へ
                    MyLog.LogWrite($"YAMLのデシリアライズに失敗しました: {filePath}。初期値で開始。");
                }
            }

            // 新規作成して返す
            return new T();
        }

        // シリアライズしてYAML保存
        public void SaveYaml<T>(T obj, string filePath)
        {
            MyLog.LogWrite($"YAMLを保存: {filePath}");
            var serializer = new YamlDotNet.Serialization.Serializer();
            string yaml = serializer.Serialize(obj);
            File.WriteAllText(filePath, yaml);
        }

        // 全体設定ファイルを読み込み
        public YamlGeneral LoadGeneralSettings()
        {
            MyLog.LogWrite("全体設定ファイルを読み込み");
            var generalPath = Path.Combine(dataDirectory, "general.yaml");
            generalSettings = LoadYamlOrCreateNew<YamlGeneral>(generalPath);
            return generalSettings;
        }

        // 全体設定ファイルを保存
        public void SaveGeneralSettings(YamlGeneral settings)
        {
            MyLog.LogWrite("全体設定ファイルを保存");
            var generalPath = Path.Combine(dataDirectory, "general.yaml");
            generalSettings = settings;
            SaveYaml(settings, generalPath);
        }

        // 全体設定からタイムゾーンを取得
        public TimeZoneInfo GetTimeZoneInfo()
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(generalSettings.TimeZone);
            }
            catch (TimeZoneNotFoundException)
            {
                MyLog.LogWrite($"指定されたタイムゾーンが見つかりません: {generalSettings.TimeZone}。デフォルトのAsia/Tokyoを使用します。");
                return TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo");
            }
            catch (InvalidTimeZoneException)
            {
                MyLog.LogWrite($"指定されたタイムゾーンが無効です: {generalSettings.TimeZone}。デフォルトのAsia/Tokyoを使用します。");
                return TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo");
            }
        }

        // 現在存在するペルソナフォルダのid+1を返す(初期値は1)
        public int GetNextPersonaId()
        {
            var personaIds = GetPersonaList();
            return personaIds.Count > 0 ? personaIds.Max() + 1 : 1;
        }

        // dataディレクトリ内のペルソナフォルダ(persona_{id})を列挙してidのリストとして返す
        // 数値としてパースできないものや、後ろに変なものが付いているものは無視する
        public List<int> GetPersonaList()
        {
            var personaIds = new List<int>();
            if (Directory.Exists(dataDirectory))
            {
                var dirs = Directory.GetDirectories(dataDirectory, $"{personaPrefix}*");
                foreach (var dir in dirs)
                {
                    var dirName = Path.GetFileName(dir);
                    var idStr = dirName.Substring(personaPrefix.Length);
                    if (int.TryParse(idStr, out int id))
                    {
                        personaIds.Add(id);
                    }
                }
            }
            MyLog.LogWrite($"ペルソナリストを取得: {string.Join(", ", personaIds)}");
            return personaIds;
        }

        // dataディレクトリ内のペルソナフォルダ(persona_{id})を列挙してidとnameのリストとして返す
        // 数値としてパースできないものや、後ろに変なものが付いているものは無視する
        // 最後の会話履歴のタイムスタンプを取得する
        public List<(int id, string name, long timestamp)> GetPersonaListWithNamesAndLastTimestamp()
        {
            var personaList = new List<(int id, string name, long timestamp)>();
            if (Directory.Exists(dataDirectory))
            {
                var dirs = Directory.GetDirectories(dataDirectory, $"{personaPrefix}*");
                foreach (var dir in dirs)
                {
                    var dirName = Path.GetFileName(dir);
                    var idStr = dirName.Substring(personaPrefix.Length);
                    if (int.TryParse(idStr, out int id))
                    {
                        var name = LoadYamlOrCreateNew<YamlPersona>(Path.Combine(dir, settingsFilename)).Name;
                        // 会話履歴ファイルのタイムスタンプを取得する
                        long? lastTimestamp = null;
                        string talkFilePath = Path.Combine(dir, talkJsonlFilename);
                        if (File.Exists(talkFilePath))
                        {
                            lastTimestamp = new DateTimeOffset(File.GetLastWriteTimeUtc(talkFilePath)).ToUnixTimeSeconds();
                        }else
                        {
                            lastTimestamp = null;
                        }
                        personaList.Add((id, name, lastTimestamp ?? 0));
                    }
                }
            }
            else
            {
                MyLog.LogWrite("dataディレクトリが存在しません。ペルソナリストを取得できません。");
            }
            MyLog.LogWrite($"ペルソナリストを取得: {string.Join(", ", personaList.Select(p => $"{p.id}:{p.name} {p.timestamp}"))}");
            return personaList;
        }

        // idからペルソナフォルダを作り、初期値のYAMLファイルを生成する
        public string? CreateNewPersona(string name)
        {
            // 新しいidを取得
            string id = GetNextPersonaId().ToString();
            string personaDir = Path.Combine(dataDirectory, $"{personaPrefix}{id}");

            //すでに存在する場合はnullを返す(通常ありえない)
            if (Directory.Exists(personaDir))
            {
                MyLog.LogWrite($"ペルソナフォルダの作成に失敗しました。すでに存在します: {personaDir}");
                throw new InvalidOperationException($"ペルソナフォルダの作成に失敗しました。すでに存在します: {personaDir}");
            }
            Directory.CreateDirectory(personaDir);

            // プロジェクトフォルダの作成
            string projectDir = Path.Combine(personaDir, "project");
            Directory.CreateDirectory(projectDir);

            // 初期設定ファイルの作成
            var persona = new YamlPersona { Name = name };
            SaveYaml(persona, Path.Combine(personaDir, settingsFilename));

            // システムプロンプトファイルの作成
            string systemPromptPath = Path.Combine(personaDir, systemPromptFilename);
            File.WriteAllText(systemPromptPath, "あなたは親切なアシスタントです。ユーザーの質問に丁寧に回答してください。");

            MyLog.LogWrite($"新しいペルソナフォルダを作成しました: {personaDir}");
            return id;
        }

        // idからペルソナフォルダを複製する。
        public int DuplicatePersonaById(int id, string? newName = null)
        {
            string sourcePersonaDir = GetPersonaDirectoryById(id);
            if (!Directory.Exists(sourcePersonaDir))
            {
                MyLog.LogWrite($"ペルソナフォルダの複製に失敗しました。元のペルソナが存在しません: {sourcePersonaDir}");
                return 0;
            }
            // 新しいidを取得
            int newId = GetNextPersonaId();
            string destPersonaDir = GetPersonaDirectoryById(newId);

            // フォルダごとコピー
            CopyDirectory(sourcePersonaDir, destPersonaDir);

            // 設定ファイルの名前を変更して保存
            var persona = LoadYamlOrCreateNew<YamlPersona>(Path.Combine(destPersonaDir, settingsFilename));
            persona.Name = newName ?? $"{persona.Name} コピー";
            SaveYaml(persona, Path.Combine(destPersonaDir, settingsFilename));

            MyLog.LogWrite($"ペルソナフォルダを複製しました: {sourcePersonaDir} -> {destPersonaDir}");
            return newId;
        }

        // idからペルソナフォルダを削除する(Windowsの場合はゴミ箱に移動する)
        public void RemovePersonaById(int id)
        {
            string personaDir = Path.Combine(dataDirectory, $"{personaPrefix}{id}");
            if (Directory.Exists(personaDir))
            {
                // Windowsの場合はゴミ箱に移動する
                if (OperatingSystem.IsWindows())
                {
                    MyLog.LogWrite($"ペルソナフォルダをゴミ箱に移動します: {personaDir}");
                    Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(
                        personaDir,
                        Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
                        Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                }
                else
                {
                    MyLog.LogWrite($"ペルソナフォルダを削除します: {personaDir}");
                    Directory.Delete(personaDir, true);
                }
            }
            else
            {
                MyLog.LogWrite($"ペルソナフォルダの削除に失敗しました。ペルソナが存在しません: {personaDir}");
            }
        }

        // ペルソナをアクティブにする
        public bool SetActivePersonaById(int id)
        {
            // idのペルソナが存在するかチェック
            var personas = GetPersonaList();
            if (!personas.Contains(id))
            {
                MyLog.LogWrite($"アクティブペルソナの設定に失敗しました。指定されたidのペルソナが存在しません: {id}");
                throw new InvalidOperationException($"アクティブペルソナの設定に失敗しました。指定されたidのペルソナが存在しません: {id}");
            }

            // general.yamlを読み込んで保持(再読み込み)
            LoadGeneralSettings();

            //すでにアクティブなら何もしない
            var currentActiveId = GetActivePersonaId();
            if (currentActiveId == id)
            {
                MyLog.LogWrite($"アクティブペルソナの設定: すでにアクティブです: {id}");
                return true;
            }

            // manage.yamlを読み込み(なければ新規作成し)アクティブペルソナidを書き込む
            var managePath = Path.Combine(dataDirectory, manageFilename);
            YamlManage manage;
            manage = LoadYamlOrCreateNew<YamlManage>(managePath);
            manage.ActivePersonaId = id;
            SaveYaml(manage, managePath);

            // talk.jsonlの内容をキャッシュに読み込む
            var activeId = GetActivePersonaId();
            if (activeId != null)
            {
                activePersonaTalkEntriesCache = GetAllTalkHistoryAllFromActivePersona();
            }

            MyLog.LogWrite($"アクティブペルソナを設定しました: {id}");

            return true;
        }

        // アクティブペルソナのidを返す。存在しなければnullを返す
        public int? GetActivePersonaId()
        {
            var managePath = Path.Combine(dataDirectory, manageFilename);
            var manage = LoadYamlOrCreateNew<YamlManage>(managePath);
            if (manage.ActivePersonaId != 0)
            {
                // MyLog.LogWrite($"アクティブペルソナIDを取得: {manage.ActivePersonaId}");
                return manage.ActivePersonaId;
            }
            MyLog.LogWrite("アクティブなペルソナがありません");
            return null;
        }

        // アクティブペルソナのidとnameを返す。存在しなければnullを返す
        public (int id, string name)? GetActivePersonaIdWithName()
        {
            var activeId = GetActivePersonaId();
            if (activeId != null)
            {
                var personaDir = GetPersonaDirectoryById(activeId.Value);
                var settingsPath = Path.Combine(personaDir, settingsFilename);
                var persona = LoadYamlOrCreateNew<YamlPersona>(settingsPath);

                MyLog.LogWrite($"アクティブペルソナIDと名前を取得: {activeId.Value}, {persona.Name}");
                return (activeId.Value, persona.Name);
            }
            MyLog.LogWrite("アクティブなペルソナがありません");
            return null;
        }

        // アクティブなペルソナのメモリファイルを読み込む
        public YamlMemory GetActivePersonaMemory()
        {
            var activeId = GetActivePersonaId();
            if (activeId != null)
            {
                var personaDir = GetPersonaDirectoryById(activeId.Value);
                var memoryPath = Path.Combine(personaDir, memoryFilename);
                MyLog.LogWrite("アクティブなペルソナのメモリファイルを読み込み完了");
                return LoadYamlOrCreateNew<YamlMemory>(memoryPath);
            }
            MyLog.LogWrite("アクティブなペルソナがありません。空のメモリを返します。");
            throw new InvalidOperationException("アクティブなペルソナがありません。空のメモリを返します。");
        }
        // アクティブなペルソナのメモリファイルをupsertして保存する(nullの場合は末尾に追加)
        public bool UpsertActivePersonaMemory(int id, string newContent)
        {
            var timeZone = GetTimeZoneInfo();
            var localTime = TimeZoneInfo.ConvertTime(DateTime.UtcNow, timeZone);
            var activeId = GetActivePersonaId();
            if (activeId != null)
            {
                var personaDir = GetPersonaDirectoryById(activeId.Value);
                var memoryPath = Path.Combine(personaDir, memoryFilename);
                var memory = LoadYamlOrCreateNew<YamlMemory>(memoryPath);

                // 該当するidのメモリを検索して更新、なければ現在の最大値+1で追加
                if (id > 0)
                {
                    var existingEntry = memory.MemoryEntries.FirstOrDefault(e => e.Id == id);
                    if (existingEntry != null)
                    {
                        // 更新
                        existingEntry.Text = newContent;

                        existingEntry.UpdatedAt = localTime.ToString("yyyy-MM-dd HH:mm:ss");
                        SaveYaml(memory, memoryPath);
                        MyLog.LogWrite($"アクティブなペルソナのメモリを更新: {id} {newContent}");
                        return true;
                    }
                    // 指定されたidが存在しない場合は追加扱いにする
                }
                // 追加
                var entry = new YamlMemoryEntry
                {
                    Id = memory.MemoryEntries.Count > 0 ? memory.MemoryEntries.Max(e => e.Id) + 1 : 1,
                    Text = newContent,
                    CreatedAt = localTime.ToString("yyyy-MM-dd HH:mm:ss"),
                    UpdatedAt = localTime.ToString("yyyy-MM-dd HH:mm:ss")
                };
                memory.MemoryEntries.Add(entry);
                SaveYaml(memory, memoryPath);
                MyLog.LogWrite($"アクティブなペルソナのメモリを追加: {entry.Id} {newContent}");
                return true;
            }
            MyLog.LogWrite("アクティブなペルソナがありません。メモリの追加/更新に失敗しました。");
            throw new InvalidOperationException("アクティブなペルソナがありません。メモリの追加/更新に失敗しました。");
        }

        // アクティブなペルソナのメモリファイルからidのメモリエントリを削除する
        public bool RemoveActivePersonaMemory(int id)
        {
            var activeId = GetActivePersonaId();
            if (activeId != null)
            {
                var personaDir = GetPersonaDirectoryById(activeId.Value);
                var memoryPath = Path.Combine(personaDir, memoryFilename);
                var memory = LoadYamlOrCreateNew<YamlMemory>(memoryPath);
                var entryToRemove = memory.MemoryEntries.FirstOrDefault(e => e.Id == id);
                if (entryToRemove != null)
                {
                    memory.MemoryEntries.Remove(entryToRemove);
                    MyLog.LogWrite($"アクティブなペルソナのメモリを削除: {id}");
                    SaveYaml(memory, memoryPath);
                    return true;
                }
                else
                {
                    MyLog.LogWrite($"アクティブなペルソナのメモリの削除に失敗しました。指定されたidのメモリが存在しません: {id}");
                    return false;
                }
            }
            MyLog.LogWrite("アクティブなペルソナがありません。メモリの削除に失敗しました。");
            throw new InvalidOperationException("アクティブなペルソナがありません。メモリの削除に失敗しました。");
        }

        // アクティブなペルソナのメモリのロックを取得してFuncを実行する。(取得できなければ待機する)
        public async Task<T> WithMemoryLock<T>(Func<Task<T>> func, CancellationToken cancellationToken)
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません");
                throw new InvalidOperationException("アクティブなペルソナがありません");
            }
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string memoryFilePath = Path.Combine(personaDir, memoryFilename);
            string lockFilePath = memoryFilePath + ".lock";

            // ロックファイルが存在する場合は待機
            if (File.Exists(lockFilePath))
            {
                MyLog.LogWrite("メモリロックの取得を待機中...");
                while (File.Exists(lockFilePath))
                {
                    await Task.Delay(100, cancellationToken);
                    cancellationToken.ThrowIfCancellationRequested();
                }
                MyLog.LogWrite("メモリロックの取得待機終了");
            }

            // ロックファイルを作成してロックを取得
            using (var lockFile = new FileStream(lockFilePath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
            {
                try
                {
                    // Funcを実行
                    MyLog.LogWrite("メモリロックを取得しました");
                    return await func();
                }
                finally
                {
                    // ロックファイルを閉じて削除
                    lockFile.Close();
                    if (File.Exists(lockFilePath))
                    {
                        File.Delete(lockFilePath);
                    }
                    MyLog.LogWrite("メモリロックを解放しました");
                }
            }
        }

        // アクティブペルソナの設定ファイルを読み込む
        public YamlPersona GetActivePersonaSettings()
        {
            var activeId = GetActivePersonaId();
            if (activeId != null)
            {
                var personaDir = GetPersonaDirectoryById(activeId.Value);
                var settingsPath = Path.Combine(personaDir, settingsFilename);
                MyLog.LogWrite("アクティブなペルソナの設定ファイルを読み込み完了");
                return LoadYamlOrCreateNew<YamlPersona>(settingsPath);
            }
            MyLog.LogWrite("アクティブなペルソナがありません。空の設定を返します。");
            return new YamlPersona();
        }

        // アクティブなペルソナの設定ファイルを保存する
        public void SaveActivePersonaSettings(YamlPersona settings)
        {
            var activeId = GetActivePersonaId();
            if (activeId != null)
            {
                var personaDir = GetPersonaDirectoryById(activeId.Value);
                var settingsPath = Path.Combine(personaDir, settingsFilename);
                MyLog.LogWrite($"アクティブなペルソナの設定ファイルを保存: {settingsPath}");
                SaveYaml(settings, settingsPath);
            }
            else
            {
                MyLog.LogWrite("アクティブなペルソナがありません。設定ファイルの保存に失敗しました。");
                throw new InvalidOperationException("アクティブなペルソナがありません。設定ファイルの保存に失敗しました。");
            }
        }

        // アクティブなペルソナフォルダ内のシステムプロンプトファイルの内容を返す
        public string GetSystemPromptFromActivePersona()
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。システムプロンプトの取得に失敗しました。");
                throw new InvalidOperationException("アクティブなペルソナがありません。システムプロンプトの取得に失敗しました。");
            }
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string systemPromptPath = Path.Combine(personaDir, systemPromptFilename);
            if (!File.Exists(systemPromptPath))
            {
                MyLog.LogWrite("アクティブなペルソナのシステムプロンプトが存在しません。");
                throw new FileNotFoundException("アクティブなペルソナのシステムプロンプトが存在しません。", systemPromptPath);
            }
            MyLog.LogWrite($"アクティブなペルソナのシステムプロンプトを取得: {systemPromptPath}");
            return File.ReadAllText(systemPromptPath);
        }

        // アクティブなペルソナフォルダ内のシステムプロンプトファイルに内容を保存する
        public void SaveSystemPromptToActivePersona(string prompt)
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。システムプロンプトの保存に失敗しました。");
                throw new InvalidOperationException("アクティブなペルソナがありません。システムプロンプトの保存に失敗しました。");
            }
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string systemPromptPath = Path.Combine(personaDir, systemPromptFilename);
            File.WriteAllText(systemPromptPath, prompt);
            MyLog.LogWrite($"アクティブなペルソナのシステムプロンプトを保存: {systemPromptPath}");
        }

        //アクティブなペルソナフォルダ内の添付フォルダ内の添付ファイルidのリストを返す
        public List<int> GetAttachmentList()
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。");
                throw new InvalidOperationException("アクティブなペルソナがありません。");
            }
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string attachmentDir = Path.Combine(personaDir, attachmentsDirectory);
            var attachmentIds = new List<int>();
            if (Directory.Exists(attachmentDir))
            {
                var files = Directory.GetFiles(attachmentDir, $"{attachmentPrefix}*");
                foreach (var file in files)
                {
                    // 拡張子は無視してid部分だけを取り出す
                    var fileName = Path.GetFileName(file);
                    var idStr = fileName.Substring(attachmentPrefix.Length);
                    var name = Path.GetFileNameWithoutExtension(idStr);
                    if (int.TryParse(name, out int id))
                    {
                        attachmentIds.Add(id);
                    }
                }
                MyLog.LogWrite($"アクティブなペルソナの添付ファイルIDリストを取得: {string.Join(", ", attachmentIds)}");
            }
            else
            {
                MyLog.LogWrite("アクティブなペルソナの添付フォルダが存在しません。");
                throw new InvalidOperationException("アクティブなペルソナの添付フォルダが存在しません。");
            }
            return attachmentIds;
        }

        // アクティブなペルソナフォルダ内の添付フォルダ内の添付ファイルidの最大値+1を返す(初期値は1)
        public int GetNextAttachmentId()
        {
            var attachmentIds = GetAttachmentList();
            return attachmentIds.Count > 0 ? attachmentIds.Max() + 1 : 1;
        }

        // アクティブなペルソナフォルダ内の添付フォルダにファイルを保存し、idを返す
        public int? SaveAttachmentToActivePersona(string filename, byte[] data)
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。添付ファイルの保存に失敗しました。");
                throw new InvalidOperationException("アクティブなペルソナがありません。添付ファイルの保存に失敗しました。");
            }
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string attachmentDir = Path.Combine(personaDir, attachmentsDirectory);
            if (!Directory.Exists(attachmentDir))
            {
                MyLog.LogWrite($"アクティブなペルソナの添付フォルダを作成: {attachmentDir}");
                Directory.CreateDirectory(attachmentDir);
            }

            // 新しいidを取得
            int newId = GetNextAttachmentId();

            // 既に同じIDのファイルが存在する場合はnullを返す(拡張子を無視して確認する)
            var existingFiles = Directory.GetFiles(attachmentDir, $"{attachmentPrefix}{newId}*");
            if (existingFiles.Length > 0)
            {
                MyLog.LogWrite($"添付ファイルの保存に失敗しました。すでに同じIDのファイルが存在します: {newId}");
                throw new InvalidOperationException($"添付ファイルの保存に失敗しました。すでに同じIDのファイルが存在します: {newId}");
            }

            // 拡張子を保持して保存
            string ext = Path.GetExtension(filename);
            string savePath = Path.Combine(attachmentDir, $"{attachmentPrefix}{newId}{ext}");
            File.WriteAllBytes(savePath, data);

            MyLog.LogWrite($"アクティブなペルソナの添付ファイルを保存: {savePath}");
            return newId;
        }

        // アクティブなペルソナフォルダ内の添付フォルダからidのファイル名と内容を取得する。存在しなければnullを返す
        public (string filename, byte[] data)? GetAttachmentFromActivePersona(int id)
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。");
                throw new InvalidOperationException("アクティブなペルソナがありません。");
            }
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string attachmentDir = Path.Combine(personaDir, attachmentsDirectory);
            if (!Directory.Exists(attachmentDir))
            {
                MyLog.LogWrite("アクティブなペルソナの添付フォルダが存在しません。");
                throw new InvalidOperationException("アクティブなペルソナの添付フォルダが存在しません。");
            }

            // idに対応するファイルを探す(拡張子は無視して確認する)
            var files = Directory.GetFiles(attachmentDir, $"{attachmentPrefix}{id}*");
            if (files.Length == 0)
            {
                MyLog.LogWrite($"アクティブなペルソナの添付ファイルが存在しません: {id}");
                return null;
            }

            // 最初に見つかったファイルを返す
            var filePath = files[0];
            var filename = Path.GetFileName(filePath);
            var data = File.ReadAllBytes(filePath);
            MyLog.LogWrite($"アクティブなペルソナの添付ファイルを取得: {filename}");
            return (filename, data);
        }

        // アクティブなペルソナフォルダ内の特定のファイル名の内容を取得する。存在しなければnullを返す
        public byte[] GetFileContentFromActivePersona(string filename)
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。");
                throw new InvalidOperationException("アクティブなペルソナがありません。");
            }
            filename = SanitizeFilename(filename);
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string filePath = Path.Combine(personaDir, filename);
            string filePathAbsolute = Path.GetFullPath(filePath);

            // パストラバーサル対策
            string personaDirAbsolute = Path.GetFullPath(personaDir);
            if (!filePathAbsolute.StartsWith(personaDirAbsolute))
            {
                MyLog.LogWrite("パストラバーサル攻撃の試行が検出されました。");
                throw new InvalidOperationException("パストラバーサル攻撃の試行が検出されました。");
            }

            if (!File.Exists(filePath))
            {
                MyLog.LogWrite($"アクティブなペルソナのファイルが存在しません: {filename}");
                return Array.Empty<byte>();
            }
            MyLog.LogWrite($"アクティブなペルソナのファイルを取得: {filename}");
            return File.ReadAllBytes(filePath);
        }

        // アクティブなペルソナフォルダ内の特定のファイル名に内容を保存する
        public bool SaveFileContentToActivePersona(string filename, byte[] data)
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。");
                throw new InvalidOperationException("アクティブなペルソナがありません。");
            }
            filename = SanitizeFilename(filename);
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string filePath = Path.Combine(personaDir, filename);
            string filePathAbsolute = Path.GetFullPath(filePath);

            // パストラバーサル対策
            string personaDirAbsolute = Path.GetFullPath(personaDir);
            if (!filePathAbsolute.StartsWith(personaDirAbsolute))
            {
                MyLog.LogWrite("パストラバーサル攻撃の試行が検出されました。");
                throw new InvalidOperationException("パストラバーサル攻撃の試行が検出されました。");
            }

            File.WriteAllBytes(filePath, data);
            MyLog.LogWrite($"アクティブなペルソナのファイルを保存: {filename}");
            return true;
        }

        // アクティブなペルソナのprojectフォルダ内の特定のファイル名の内容を取得する。存在しなければnullを返す
        public string GetProjectFileContentFromActivePersona(string filename)
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。");
                throw new InvalidOperationException("アクティブなペルソナがありません。");
            }
            filename = SanitizeFilename(filename);
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string projectDir = Path.Combine(personaDir, "project");
            string filePath = Path.Combine(projectDir, filename);
            string filePathAbsolute = Path.GetFullPath(filePath);

            // パストラバーサル対策
            string projectDirAbsolute = Path.GetFullPath(projectDir);
            if (!filePathAbsolute.StartsWith(projectDirAbsolute))
            {
                MyLog.LogWrite("パストラバーサル攻撃の試行が検出されました。");
                throw new InvalidOperationException("パストラバーサル攻撃の試行が検出されました。");
            }

            if (!File.Exists(filePath))
            {
                MyLog.LogWrite($"アクティブなペルソナのプロジェクトファイルが存在しません: {filename}");
                return string.Empty;
            }
            MyLog.LogWrite($"アクティブなペルソナのプロジェクトファイルを取得: {filename}");
            return File.ReadAllText(filePath);
        }

        // アクティブなペルソナのprojectフォルダ内の特定のファイル名に内容を保存する
        public bool SaveProjectFileContentToActivePersona(string filename, string data)
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。");
                throw new InvalidOperationException("アクティブなペルソナがありません。");
            }
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string projectDir = Path.Combine(personaDir, "project");
            if (!Directory.Exists(projectDir))
            {
                Directory.CreateDirectory(projectDir);
            }
            filename = SanitizeFilename(filename);
            string filePath = Path.Combine(projectDir, filename);
            string filePathAbsolute = Path.GetFullPath(filePath);

            // パストラバーサル対策
            string projectDirAbsolute = Path.GetFullPath(projectDir);
            if (!filePathAbsolute.StartsWith(projectDirAbsolute))
            {
                MyLog.LogWrite("パストラバーサル攻撃の試行が検出されました。");
                throw new InvalidOperationException("パストラバーサル攻撃の試行が検出されました。");
            }

            File.WriteAllText(filePath, data);
            MyLog.LogWrite($"アクティブなペルソナのプロジェクトファイルを保存: {filename}");
            return true;
        }

        // アクティブなペルソナのprojectフォルダ内のファイルリストを取得する
        public List<string> GetProjectFileListFromActivePersona()
        {
            var activeId = GetActivePersonaId();
            var fileList = new List<string>();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。");
                throw new InvalidOperationException("アクティブなペルソナがありません。");
            }
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string projectDir = Path.Combine(personaDir, "project");
            if (!Directory.Exists(projectDir))
            {
                MyLog.LogWrite("アクティブなペルソナのプロジェクトフォルダが存在しません。");
                throw new InvalidOperationException("アクティブなペルソナのプロジェクトフォルダが存在しません。");
            }

            var files = Directory.GetFiles(projectDir);
            foreach (var file in files)
            {
                var fileName = Path.GetFileName(file);
                fileList.Add(fileName);
            }
            MyLog.LogWrite($"アクティブなペルソナのプロジェクトファイルリストを取得: {string.Join(", ", fileList)}");
            return fileList;
        }

        // アクティブなペルソナの会話履歴のロックを取得してFuncを実行する。(取得できなければ待機する)
        public async Task<T> WithTalkHistoryLock<T>(Func<Task<T>> func, CancellationToken cancellationToken)
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません");
                throw new InvalidOperationException("アクティブなペルソナがありません");
            }
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string talkFilePath = Path.Combine(personaDir, talkJsonlFilename);
            string lockFilePath = talkFilePath + ".lock";

            // ロックファイルが存在する場合は待機
            if (File.Exists(lockFilePath))
            {
                MyLog.LogWrite("会話履歴ロックの取得を待機中...");
                while (File.Exists(lockFilePath))
                {
                    await Task.Delay(100, cancellationToken);
                    cancellationToken.ThrowIfCancellationRequested();
                }
                MyLog.LogWrite("会話履歴ロックの取得待機終了");
            }

            // ロックファイルを作成してロックを取得
            using (var lockFile = new FileStream(lockFilePath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
            {
                try
                {
                    // Funcを実行
                    MyLog.LogWrite("会話履歴ロックを取得しました");
                    return await func();
                }
                finally
                {
                    // ロックファイルを閉じて削除
                    lockFile.Close();
                    if (File.Exists(lockFilePath))
                    {
                        File.Delete(lockFilePath);
                    }
                    MyLog.LogWrite("会話履歴ロックを解放しました");
                }
            }
        }

        // アクティブなペルソナの会話履歴を全件取得する。存在しなければ空リストを返す。
        private List<TalkEntry> GetAllTalkHistoryAllFromActivePersona()
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません");
                throw new InvalidOperationException("アクティブなペルソナがありません");
            }
            string personaDir = GetPersonaDirectoryById(activeId.Value);
            string talkFilePath = Path.Combine(personaDir, talkJsonlFilename);
            if (!File.Exists(talkFilePath))
            {
                MyLog.LogWrite("会話履歴ファイルが存在しません");
                return new List<TalkEntry>();
            }

            var allLines = File.ReadAllLines(talkFilePath);
            var result = new List<TalkEntry>();
            MyLog.LogWrite($"会話履歴ファイルの行数: {allLines.Length}");

            foreach (var line in allLines)
            {
                try
                {
                    var entry = JsonSerializer.Deserialize<TalkEntry>(line, new JsonSerializerOptions
                    {
                        Converters =
                        {
                            new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)
                        }
                    });
                    if (entry != null)
                    {
                        result.Add(entry);
                    }
                }
                catch
                {
                    MyLog.LogWrite($"会話履歴のデシリアライズに失敗しました。該当行をスキップします。 Line: {line}");
                }
            }
            return result;
        }

        // アクティブなペルソナの会話履歴を全件取得する。存在しなければ空リストを返す。(キャッシュを使用)
        public List<TalkEntry> GetAllTalkHistoryAllFromActivePersonaCached()
        {
            if (activePersonaTalkEntriesCache.Count == 0)
            {
                MyLog.LogWrite("アクティブなペルソナの会話履歴がキャッシュに存在しません");
                return new List<TalkEntry>();
            }
            return activePersonaTalkEntriesCache;
        }

        // アクティブなペルソナの会話履歴の最後の一行を取得する。存在しなければnullを返す。(キャッシュを使用)
        public TalkEntry? GetLastTalkEntryFromActivePersona()
        {
            if (activePersonaTalkEntriesCache.Count == 0)
            {
                MyLog.LogWrite("アクティブなペルソナの会話履歴がキャッシュに存在しません");
                return null;
            }
            return activePersonaTalkEntriesCache.Last();
        }

        // アクティブなペルソナの会話履歴を取得する。存在しなければ空リストを返す。ファイル全体で何行あるのかも合わせて返す。
        public (List<TalkEntry> messages, int total) GetTalkHistoryFromActivePersona(int index = -1, int count = 50)
        {
            // indexが負の数の場合は、最後からcount分を返すようにする
            if (index < 0)
            {
                index = int.MaxValue;
            }

            var allMessages = activePersonaTalkEntriesCache;
            int total = allMessages.Count;

            int startIndex = Math.Min(index, total);
            int takeCount = Math.Min(count, total - startIndex);

            // indexが負の数の場合は、最後からcount分を返すようにする
            if (index == int.MaxValue)
            {
                startIndex = Math.Max(0, total - count);
                takeCount = Math.Min(count, total);
            }

            var result = allMessages.Skip(startIndex).Take(takeCount).ToList();
            MyLog.LogWrite($"アクティブなペルソナの会話履歴を取得しました。取得件数: {result.Count} / {total} (index: {index}, count: {count})");

            return (result, total);
        }

        // アクティブなペルソナの会話履歴にメッセージを追加(id不一致)または更新(id一致)する
        public Guid UpsertTalkHistoryToActivePersona(TalkEntry message)
        {
            var activeId = GetActivePersonaId();
            if (activeId == null)
            {
                MyLog.LogWrite("アクティブなペルソナがありません。会話履歴の追加/更新に失敗しました。");
                throw new InvalidOperationException("アクティブなペルソナがありません。会話履歴の追加/更新に失敗しました。");
            }

            var activePersonaDir = GetPersonaDirectoryById(activeId.Value);
            var talkFilePath = Path.Combine(activePersonaDir, talkJsonlFilename);

            // 会話履歴を取得(安全のためキャッシュは使わない)
            var messages = GetAllTalkHistoryAllFromActivePersona();

            if (message.Uuid == Guid.Empty)
            {
                // メッセージにuuidを追加する
                message.Uuid = Guid.NewGuid();

                // 新規追加はファイルの末尾に追加するだけで良い
                using (var writer = new StreamWriter(talkFilePath, append: true, new UTF8Encoding(false)))
                {
                    var line = Serializer.JsonSerialize(message, false);
                    writer.WriteLine(line);
                    writer.Flush();
                    MyLog.LogWrite($"アクティブなペルソナの会話履歴にメッセージを追加しました。 UUID: {message.Uuid}");
                }
            }
            else
            {
                // 更新
                var index = messages.FindIndex(m => m.Uuid == message.Uuid);
                if (index != -1)
                {
                    // 指定されたuuidのメッセージを更新
                    messages[index] = message;

                    // これ以降のメッセージが存在する場合は全部削除する。
                    messages = messages.Take(index + 1).ToList();

                    // 全体をjsonl形式で保存し直す
                    using (var writer = new StreamWriter(talkFilePath, append: false, new UTF8Encoding(false)))
                    {
                        foreach (var msg in messages)
                        {
                            var line = Serializer.JsonSerialize(msg, false);
                            writer.WriteLine(line);
                        }
                        writer.Flush();
                        MyLog.LogWrite($"アクティブなペルソナの会話履歴のメッセージを更新しました。 UUID: {message.Uuid}");
                    }
                }
                else
                {
                    // idが見つからなかった場合は失敗
                    MyLog.LogWrite($"アクティブなペルソナの会話履歴の更新に失敗しました。検索異常。");
                    return Guid.Empty;
                }
            }

            // キャッシュを更新
            activePersonaTalkEntriesCache = GetAllTalkHistoryAllFromActivePersona();
            return message.Uuid;
        }

        // アクティブなペルソナの会話統計を取得する
        public TalkStats? GetTalkStatsFromActivePersona()
        {
            // 会話履歴をすべて取得     
            var messages = activePersonaTalkEntriesCache;
            // システムプロンプトを取得
            var rawSystemPrompt = GetSystemPromptFromActivePersona();
            var builtSystemPrompt = SystemPrompt.BuildSystemPrompt(this, true); //会話統計取得処理はスキップさせる(無限ループするので)

            // 総トークン数
            var totalTokens = Tokens.CountTalkTokens(messages);
            // 残存メッセージ数
            var remainingMessages = Tokens.TrimTalkTokens(builtSystemPrompt, messages, generalSettings.TalkHistoryCutoffThreshold);
            // アーカイブされたメッセージ数
            var archivedMessages = messages.Count - remainingMessages.Count;
            if (archivedMessages < 0)
            {
                archivedMessages = 0;
            }

            // 過去8時間以内のユーザーメッセージ数をカウント
            DateTimeOffset now = DateTimeOffset.UtcNow;
            DateTimeOffset cutoffTime = now.AddHours(-8);
            int userLast8h = 0;

            foreach (var entry in messages)
            {
                if (entry.Role == TalkRole.User)
                {
                    var entryTime = DateTimeOffset.FromUnixTimeSeconds(entry.Timestamp);
                    if (entryTime >= cutoffTime)
                    {
                        userLast8h++;
                    }
                }
            }

            // 統計情報を計算
            var stats = new TalkStats
            {
                Total = messages.Count, // 総メッセージ数
                TotalTokens = totalTokens, // 総トークン数
                Archived = archivedMessages, // アーカイブ済みメッセージ数
                NeedUserRestRemind = userLast8h >= generalSettings.BreakReminderThreshold, // 休憩リマインドが必要かどうかを判定
                UserLast8h = userLast8h, // 過去8時間のユーザーメッセージ数
                BuiltSystemPromptTokens = Tokens.CountTokens(builtSystemPrompt), // システムプロンプトのトークン数
                RawSystemPromptTokens = Tokens.CountTokens(rawSystemPrompt) // 生のシステムプロンプトのトークン数
            };

            MyLog.LogWrite($"アクティブなペルソナの会話統計を取得しました。 総メッセージ数: {stats.Total}, 総トークン数: {stats.TotalTokens}, アーカイブ済みメッセージ数: {stats.Archived}, 過去8時間のユーザーメッセージ数: {stats.UserLast8h}, 休憩リマインド必要: {stats.NeedUserRestRemind}");
            return stats;
        }

        // mcp.jsonを読み込む
        public string GetMcpJson()
        {
            var mcpPath = Path.Combine(dataDirectory, mcpJsonFilename);
            if (File.Exists(mcpPath))
            {
                MyLog.LogWrite("mcp.jsonファイルを読み込み完了");
                return File.ReadAllText(mcpPath);
            }

            // 存在しない場合は空文字を返す
            MyLog.LogWrite("mcp.jsonファイルが存在しません。空文字を返します。");
            return string.Empty;
        }

        // mcp.jsonを保存する
        public void SaveMcpJson(string json)
        {
            var mcpPath = Path.Combine(dataDirectory, mcpJsonFilename);
            File.WriteAllText(mcpPath, json);
            MyLog.LogWrite("mcp.jsonファイルを保存しました。");
        }

        // ファイル名に使えない文字を除去する(ディレクトリトラバーサル対策)
        private string SanitizeFilename(string filename)
        {
            var invalidChars = Path.GetInvalidFileNameChars();
            var sanitized = new string(filename.Where(c => !invalidChars.Contains(c)).ToArray());
            return sanitized;
        }
    }
}