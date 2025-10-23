using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;


namespace CllDotnet
{
    public static class Broadcaster
    {
        static Func<Dictionary<string, object>, Task>? broadcastAction;
        public static void Initialize(Func<Dictionary<string, object>, Task> action)
        {
            broadcastAction = action;
        }
        public static async Task Broadcast(Dictionary<string, object> message)
        {
            if (broadcastAction != null)
            {
                await broadcastAction.Invoke(message);
            }
        }
    }
}