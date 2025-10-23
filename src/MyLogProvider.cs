using System;
using Microsoft.Extensions.Logging;

namespace CllDotnet
{
    public class MyLogProvider : ILoggerProvider
    {
        public ILogger CreateLogger(string categoryName)
        {
            return new MyLogger(categoryName);
        }

        public void Dispose() { }
    }

    public class MyLogger : ILogger
    {
        private readonly string _categoryName;

        public MyLogger(string categoryName)
        {
            _categoryName = categoryName;
        }

        IDisposable ILogger.BeginScope<TState>(TState state)
        {
            return default!;
        }

        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel)
        {
            return logLevel >= Microsoft.Extensions.Logging.LogLevel.Information; // フィルタ調整可
        }

        public void Log<TState>(
            Microsoft.Extensions.Logging.LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;

            var message = formatter(state, exception);
            string level = logLevel switch
            {
                Microsoft.Extensions.Logging.LogLevel.Trace => "Trace",
                Microsoft.Extensions.Logging.LogLevel.Debug => "Debug",
                Microsoft.Extensions.Logging.LogLevel.Information => "Info",
                Microsoft.Extensions.Logging.LogLevel.Warning => "Warning",
                Microsoft.Extensions.Logging.LogLevel.Error => "Error",
                Microsoft.Extensions.Logging.LogLevel.Critical => "Exception",
                _ => "Other"
            };

            // 共通ログ関数経由でDB記録
            MyLog.LogWrite($"{_categoryName} [{level}] {message}");
        }
    }
}
