using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CllDotnet
{
    public static class Serializer
    {
        public static string JsonSerialize<T>(T obj, bool indented = true)
        {
            var line = JsonSerializer.Serialize(obj, new JsonSerializerOptions()
            {
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
                WriteIndented = indented,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
                Converters =
                                {
                                    new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)
                                }
            });
            if(indented)
            {
                return line;
            }
            else
            {
                //改行は除去する
                line = line.Replace("\r\n", "");
                line = line.Replace("\n", "");
                return line;
            }
        }
    }
}