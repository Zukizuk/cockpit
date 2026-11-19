// Ctrl+Alt+K brings Cockpit up from anywhere in Windows. A shortcut file's own hotkey turned out unreliable (Explorer
// only sometimes registers it, and a reinstall of the app drops it), so this small program holds the key itself:
// it registers it with Windows, waits, and opens Cockpit's Start Menu shortcut when it's pressed. The installed app
// brings its open window forward rather than opening a second one. One copy runs at a time; it starts at login.
// It also keeps Cockpit's server up: every 30 seconds (and before opening the window) it checks the server answers on
// 127.0.0.1:4790 and starts it if not, so a server that died (killed with whatever started it, a crash) comes back.
// Arguments: [Start Menu shortcut to open] [start-hidden.vbs that starts the server]
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;

static class CockpitHotkey
{
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

    const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_NOREPEAT = 0x4000, VK_K = 0x4B, WM_HOTKEY = 0x0312;

    static string starter = "";
    static DateTime lastStart = DateTime.MinValue;

    static bool ServerUp()
    {
        try
        {
            using (var c = new TcpClient())
            {
                var t = c.BeginConnect("127.0.0.1", 4790, null, null);
                return t.AsyncWaitHandle.WaitOne(1500) && c.Connected;
            }
        }
        catch
        {
            return false;
        }
    }

    /** Starts the server when it doesn't answer (the server itself exits if another copy already runs). */
    static void EnsureServer()
    {
        if (starter == "" || !File.Exists(starter) || ServerUp()) return;
        if ((DateTime.Now - lastStart).TotalSeconds < 20) return; // give the last start time to come up
        lastStart = DateTime.Now;
        try
        {
            Process.Start(new ProcessStartInfo("wscript.exe", "\"" + starter + "\"") { UseShellExecute = false, CreateNoWindow = true });
        }
        catch
        {
            // try again on the next round
        }
    }

    static void Main(string[] args)
    {
        bool first;
        using (new Mutex(true, "Local\\CockpitHotkey", out first))
        {
            if (!first) return;
            // what to open and the server starter: given, or read from app.txt and server.txt beside this program
            string here = AppDomain.CurrentDomain.BaseDirectory;
            Func<string, string> note = name => File.Exists(Path.Combine(here, name)) ? File.ReadAllText(Path.Combine(here, name)).Trim() : "";
            string target = args.Length > 0 ? args[0] : note("app.txt");
            if (target == "") target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Cockpit.lnk");
            starter = args.Length > 1 ? args[1] : note("server.txt");
            var watch = new Timer(_ => EnsureServer(), null, 0, 30000);
            // if another program holds the key, this still keeps the server up (the loop then just waits)
            RegisterHotKey(IntPtr.Zero, 1, MOD_ALT | MOD_CONTROL | MOD_NOREPEAT, VK_K);
            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                if (msg.message != WM_HOTKEY) continue;
                try
                {
                    EnsureServer();
                    AllowSetForegroundWindow(-1); // let the app's window come to the front
                    // "program|arguments" (the installed app's launcher), or a shortcut or file to open
                    int bar = target.IndexOf('|');
                    Process.Start(bar > 0
                        ? new ProcessStartInfo(target.Substring(0, bar), target.Substring(bar + 1)) { UseShellExecute = false }
                        : new ProcessStartInfo(target) { UseShellExecute = true });
                }
                catch
                {
                    // the shortcut is gone (app reinstalled): nothing to open until it's back
                }
            }
            GC.KeepAlive(watch);
        }
    }
}
