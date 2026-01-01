using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Data.Sqlite;

namespace CllDotnet
{
    public class SQLiteDB
    {
        private readonly string databasePath;
        private readonly object syncRoot = new object();

        public int PersonaId { get; }

        public SQLiteDB(string databasePath, int personaId = 0)
        {
            this.databasePath = databasePath;
            PersonaId = personaId;

            var directory = Path.GetDirectoryName(databasePath);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            EnsureSchema();
        }

        private SqliteConnection CreateConnection()
        {
            var connection = new SqliteConnection($"Data Source={databasePath}");
            connection.Open();
            return connection;
        }

        private void EnsureSchema()
        {
            lock (syncRoot)
            {
                using var connection = CreateConnection();
                using var command = connection.CreateCommand();
                command.CommandText = @"CREATE TABLE IF NOT EXISTS talk_entries (
    uuid TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    reasoning TEXT,
    tool_detail TEXT,
    attachment_id TEXT,
    timestamp INTEGER NOT NULL,
    tokens INTEGER NOT NULL
);";
                command.ExecuteNonQuery();
            }
        }

        public bool MigrateFromJsonlIfExists(string jsonlPath)
        {
            if (!File.Exists(jsonlPath))
            {
                return false;
            }
            MyLog.LogWrite($"talk.jsonlファイルが見つかりました。SQLiteデータベースにマイグレーションを開始します: {jsonlPath}");

            var options = new JsonSerializerOptions
            {
                Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
            };

            var entries = new List<TalkEntry>();
            var lines = File.ReadAllLines(jsonlPath);
            foreach (var line in lines)
            {
                try
                {
                    var entry = JsonSerializer.Deserialize<TalkEntry>(line, options);
                    if (entry != null)
                    {
                        if (entry.Uuid == Guid.Empty)
                        {
                            entry.Uuid = Guid.NewGuid();
                        }
                        entries.Add(entry);
                    }
                }
                catch (Exception ex)
                {
                    MyLog.LogWrite($"talk.jsonlのマイグレーション中に失敗しました: {ex.Message} {ex.StackTrace}");
                }
            }

            lock (syncRoot)
            {
                using var connection = CreateConnection();
                using var transaction = connection.BeginTransaction();

                using (var deleteCmd = connection.CreateCommand())
                {
                    deleteCmd.Transaction = transaction;
                    deleteCmd.CommandText = "DELETE FROM talk_entries;";
                    deleteCmd.ExecuteNonQuery();
                }

                foreach (var entry in entries)
                {
                    InsertOrReplace(connection, transaction, entry);
                }

                transaction.Commit();
            }

            var backupPath = GetBackupPath(jsonlPath);
            File.Move(jsonlPath, backupPath);
            MyLog.LogWrite($"talk.jsonlをSQLiteにマイグレーションしました: {backupPath}");
            return true;
        }

        private string GetBackupPath(string originalPath)
        {
            var backupPath = originalPath + ".bak";
            int counter = 1;
            while (File.Exists(backupPath))
            {
                backupPath = $"{originalPath}.bak.{counter}";
                counter++;
            }
            return backupPath;
        }

        public List<TalkEntry> GetAllTalkEntries()
        {
            lock (syncRoot)
            {
                var result = new List<TalkEntry>();

                using var connection = CreateConnection();
                using var command = connection.CreateCommand();
                command.CommandText = @"SELECT uuid, role, text, reasoning, tool_detail, attachment_id, timestamp, tokens FROM talk_entries ORDER BY rowid ASC;";

                using var reader = command.ExecuteReader();
                while (reader.Read())
                {
                    var entry = new TalkEntry
                    {
                        Uuid = Guid.TryParse(reader.IsDBNull(0) ? string.Empty : reader.GetString(0), out var parsedUuid) ? parsedUuid : Guid.Empty,
                        Role = ParseRole(reader.IsDBNull(1) ? string.Empty : reader.GetString(1)),
                        Text = reader.IsDBNull(2) ? string.Empty : reader.GetString(2),
                        Reasoning = reader.IsDBNull(3) ? string.Empty : reader.GetString(3),
                        ToolDetail = reader.IsDBNull(4) ? string.Empty : reader.GetString(4),
                        AttachmentId = ParseAttachments(reader.IsDBNull(5) ? null : reader.GetString(5)),
                        Timestamp = reader.IsDBNull(6) ? 0 : reader.GetInt64(6),
                        Tokens = reader.IsDBNull(7) ? 0 : reader.GetInt32(7)
                    };
                    result.Add(entry);
                }

                return result;
            }
        }

        public Guid UpsertTalkEntry(TalkEntry entry)
        {
            lock (syncRoot)
            {
                EnsureSchema();

                using var connection = CreateConnection();
                using var transaction = connection.BeginTransaction();

                if (entry.Uuid == Guid.Empty)
                {
                    entry.Uuid = Guid.NewGuid();
                }

                long? existingRowId = GetRowId(connection, transaction, entry.Uuid);

                if (existingRowId.HasValue)
                {
                    DeleteAfterRow(connection, transaction, existingRowId.Value);
                    UpdateEntry(connection, transaction, entry);
                }
                else
                {
                    InsertEntry(connection, transaction, entry);
                }

                transaction.Commit();
                return entry.Uuid;
            }
        }

        private long? GetRowId(SqliteConnection connection, SqliteTransaction transaction, Guid uuid)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT rowid FROM talk_entries WHERE uuid = $uuid;";
            command.Parameters.AddWithValue("$uuid", uuid.ToString());
            var result = command.ExecuteScalar();
            if (result == null || result == DBNull.Value)
            {
                return null;
            }
            return Convert.ToInt64(result);
        }

        private void DeleteAfterRow(SqliteConnection connection, SqliteTransaction transaction, long rowId)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "DELETE FROM talk_entries WHERE rowid > $rowId;";
            command.Parameters.AddWithValue("$rowId", rowId);
            command.ExecuteNonQuery();
        }

        private void UpdateEntry(SqliteConnection connection, SqliteTransaction transaction, TalkEntry entry)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = @"UPDATE talk_entries
SET role = $role,
    text = $text,
    reasoning = $reasoning,
    tool_detail = $toolDetail,
    attachment_id = $attachmentId,
    timestamp = $timestamp,
    tokens = $tokens
WHERE uuid = $uuid;";
            BindEntryParameters(command, entry);
            command.ExecuteNonQuery();
        }

        private void InsertEntry(SqliteConnection connection, SqliteTransaction transaction, TalkEntry entry)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = @"INSERT INTO talk_entries (uuid, role, text, reasoning, tool_detail, attachment_id, timestamp, tokens)
VALUES ($uuid, $role, $text, $reasoning, $toolDetail, $attachmentId, $timestamp, $tokens);";
            BindEntryParameters(command, entry);
            command.ExecuteNonQuery();
        }

        private void InsertOrReplace(SqliteConnection connection, SqliteTransaction transaction, TalkEntry entry)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = @"INSERT OR REPLACE INTO talk_entries (uuid, role, text, reasoning, tool_detail, attachment_id, timestamp, tokens)
VALUES ($uuid, $role, $text, $reasoning, $toolDetail, $attachmentId, $timestamp, $tokens);";
            BindEntryParameters(command, entry);
            command.ExecuteNonQuery();
        }

        private void BindEntryParameters(SqliteCommand command, TalkEntry entry)
        {
            command.Parameters.AddWithValue("$uuid", entry.Uuid.ToString());
            command.Parameters.AddWithValue("$role", NormalizeRole(entry.Role));
            command.Parameters.AddWithValue("$text", entry.Text ?? string.Empty);
            command.Parameters.AddWithValue("$reasoning", string.IsNullOrEmpty(entry.Reasoning) ? (object)DBNull.Value : entry.Reasoning);
            command.Parameters.AddWithValue("$toolDetail", string.IsNullOrEmpty(entry.ToolDetail) ? (object)DBNull.Value : entry.ToolDetail);

            var attachmentsJson = entry.AttachmentId == null ? null : JsonSerializer.Serialize(entry.AttachmentId);
            command.Parameters.AddWithValue("$attachmentId", attachmentsJson ?? (object)DBNull.Value);
            command.Parameters.AddWithValue("$timestamp", entry.Timestamp);
            command.Parameters.AddWithValue("$tokens", entry.Tokens);
        }

        private TalkRole ParseRole(string role)
        {
            if (Enum.TryParse(role, true, out TalkRole parsed))
            {
                return parsed;
            }

            return TalkRole.Unknown;
        }

        private string NormalizeRole(TalkRole role)
        {
            return role.ToString().ToLowerInvariant();
        }

        private List<int>? ParseAttachments(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return null;
            }

            try
            {
                return JsonSerializer.Deserialize<List<int>>(raw);
            }
            catch
            {
                MyLog.LogWrite("添付IDのデシリアライズに失敗しました。値を破棄します。");
                return null;
            }
        }
    }
}
