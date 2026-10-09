'use strict';
// Follows the Claude windows Flock manages: where each one is on screen, which
// part of it no other window covers, and which one has focus. It also says
// which window lies under the island, so the island can step aside for it.
// Node can't reach
// the Win32 calls this needs (window order, DWM frame bounds, window-event
// hooks), so a small C# class runs inside one long-lived PowerShell, as in
// procscan.js, and prints a JSON line whenever that picture changes.
//
// It also names a window after its account where Windows shows it: the title,
// the window icon (Alt+Tab, Win+Tab) and the taskbar identity (its own button,
// with that account's icon). Those are properties Windows keeps on the window;
// the helper puts them back as they were when asked, and before it exits. It
// remembers the title Claude itself gave each window (a chat in a window of
// its own carries the chat's name), and brings a window to the front when the
// island is clicked for it, as its taskbar button would. It never moves,
// restyles or draws on a window.

const { spawn } = require('child_process');
const { log } = require('./log');

// Reads the C# below from stdin (it is too long for -EncodedCommand), compiles
// it, then passes every further line on as a command.
const BOOT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$src = New-Object System.Text.StringBuilder
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($null -eq $l) { exit }
  if ($l -eq '//END') { break }
  [void]$src.AppendLine($l)
}
try { Add-Type -TypeDefinition $src.ToString() }
catch {
  [Console]::Out.WriteLine('{"error":' + (ConvertTo-Json -InputObject ([string]$_) -Compress) + '}')
  [Console]::Out.Flush()
  exit
}
[FlockWinTrack]::Start()
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($null -eq $l) { break }
  [FlockWinTrack]::Command($l)
}
[FlockWinTrack]::Stop()
`;

// Kept to plain ASCII: it travels through PowerShell's stdin. Text for titles
// arrives base64-encoded for the same reason.
const CS = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class FlockWinTrack {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
    [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
    [PreserveSig] int Commit();
  }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  public delegate void WinEventProc(IntPtr hook, uint ev, IntPtr h, int obj, int child, uint thread, uint time);
  public delegate void TimerProc(IntPtr h, uint msg, IntPtr id, uint time);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageTimeoutW")] static extern IntPtr SendText(IntPtr h, uint msg, IntPtr w, string l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr inst, string name, uint type, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern int GetSystemMetricsForDpi(int index, uint dpi);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT v);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc f, uint pid, uint tid, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint tid, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetTimer(IntPtr h, IntPtr id, uint ms, TimerProc f);
  [DllImport("user32.dll")] static extern bool KillTimer(IntPtr h, IntPtr id);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  const uint WM_QUIT = 0x0012, WM_APP = 0x8000, WM_RAISE = 0x8001, WM_SETTEXT = 0x000C, WM_SETICON = 0x0080, SMTO_ABORTIFHUNG = 0x0002;
  const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
  const int WS_THICKFRAME = 0x00040000, WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_LAYERED = 0x80000, WS_EX_NOACTIVATE = 0x08000000;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
  static readonly Guid AppUserModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
  static Guid IID_IPropertyStore = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");

  static readonly object sync = new object();
  static HashSet<uint> pids = new HashSet<uint>();   // processes whose main windows are followed
  static HashSet<long> skip = new HashSet<long>();   // windows that never count as covering one
  static RECT zone;                                   // the island's area; the window on top there is reported
  static bool hasZone;
  static readonly HashSet<long> moving = new HashSet<long>();
  static readonly List<IntPtr> hooks = new List<IntPtr>();
  // Win32 keeps calling these, so they live in fields the GC can't collect.
  static WinEventProc onEvent;
  static TimerProc onSoon, onTick;
  static EnumProc onWindow;
  static IntPtr soonTimer = IntPtr.Zero;
  static uint threadId;
  static string last = "";
  // One pass over the windows, top of the z-order first.
  static HashSet<uint> passPids;
  static HashSet<long> passSkip;
  static List<RECT> above;
  static StringBuilder json;
  static bool first;
  static RECT passZone;
  static bool passHasZone;
  static string under;

  // What Flock has given each window, and what to put back. Own: the title Claude
  // gave it, null when an earlier Flock had already renamed it.
  class Named { public string Title, Before, Own, Icon, Taskbar; public IntPtr Small, Big; }
  static readonly Dictionary<long, Named> named = new Dictionary<long, Named>();

  public static void Start() {
    ManualResetEvent ready = new ManualResetEvent(false);
    Thread t = new Thread(() => Loop(ready));
    t.IsBackground = true;
    t.Start();
    ready.WaitOne();
  }

  public static void Stop() {
    PlainAll();
    if (threadId != 0) PostThreadMessage(threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
  }

  //  pids=1,2;skip=3,4;zone=l,t,r,b           follow these processes' windows; watch the island's area
  //  name <hwnd> <title> <icon> <appid> <relaunch command> <relaunch name>   (base64 each, "-" for none)
  //  plain <hwnd>  /  plainall                put windows back as they were
  //  raise <hwnd>                             bring a window to the front
  public static void Command(string line) {
    line = line ?? "";
    if (line.StartsWith("name ")) { Name(line.Split(' ')); return; }
    if (line.StartsWith("plain ")) { long h; if (long.TryParse(line.Substring(6).Trim(), out h)) Plain(new IntPtr(h)); return; }
    if (line.StartsWith("raise ")) { long h; if (long.TryParse(line.Substring(6).Trim(), out h)) PostThreadMessage(threadId, WM_RAISE, new IntPtr(h), IntPtr.Zero); return; }
    if (line == "plainall") { PlainAll(); Console.Out.WriteLine("{\"plain\":true}"); Console.Out.Flush(); return; }
    HashSet<uint> p = new HashSet<uint>();
    HashSet<long> s = new HashSet<long>();
    List<int> z = new List<int>();
    foreach (string part in line.Split(';')) {
      string[] kv = part.Split('=');
      if (kv.Length != 2) continue;
      string key = kv[0].Trim();
      foreach (string v in kv[1].Split(',')) {
        long n;
        if (!long.TryParse(v.Trim(), out n)) continue;
        if (key == "pids") p.Add((uint)n);
        else if (key == "skip") s.Add(n);
        else if (key == "zone") z.Add((int)n);
      }
    }
    lock (sync) {
      pids = p; skip = s;
      hasZone = z.Count == 4;
      if (hasZone) zone = Rc(z[0], z[1], z[2], z[3]);
    }
    PostThreadMessage(threadId, WM_APP, IntPtr.Zero, IntPtr.Zero);
  }

  static string Arg(string[] a, int i) {
    if (i >= a.Length || a[i] == "-") return null;
    try { return Encoding.UTF8.GetString(Convert.FromBase64String(a[i])); } catch { return null; }
  }

  static string TitleOf(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }

  static void SetTitle(IntPtr h, string text) {
    IntPtr r;
    SendText(h, WM_SETTEXT, IntPtr.Zero, text, SMTO_ABORTIFHUNG, 1000, out r);
  }

  static void Name(string[] a) {
    long key;
    if (a.Length < 7 || !long.TryParse(a[1], out key)) return;
    IntPtr h = new IntPtr(key);
    if (!IsWindow(h)) return;
    string title = Arg(a, 2), icon = Arg(a, 3), appId = Arg(a, 4), cmd = Arg(a, 5), label = Arg(a, 6);
    Named n;
    lock (sync) {
      if (!named.TryGetValue(key, out n)) {
        n = new Named();
        n.Before = n.Own = TitleOf(h);
        if (n.Before.EndsWith(" " + (char)0x2014 + " Claude")) { n.Before = "Claude"; n.Own = null; } // still named by an earlier Flock
        named[key] = n;
      }
      n.Title = title; // first: KeepTitle must not take Flock's own renaming for Claude's
    }
    if (title != null && TitleOf(h) != title) SetTitle(h, title);
    if (icon != n.Icon) {
      IntPtr small = IntPtr.Zero, big = IntPtr.Zero;
      if (icon != null) {
        uint dpi = GetDpiForWindow(h);
        if (dpi == 0) dpi = 96;
        int s = GetSystemMetricsForDpi(49, dpi), b = GetSystemMetricsForDpi(11, dpi); // SM_CXSMICON, SM_CXICON
        small = LoadImage(IntPtr.Zero, icon, 1, s, s, 0x10); // IMAGE_ICON, LR_LOADFROMFILE
        big = LoadImage(IntPtr.Zero, icon, 1, b, b, 0x10);
      }
      SetIcons(h, small, big);
      if (n.Small != IntPtr.Zero) DestroyIcon(n.Small);
      if (n.Big != IntPtr.Zero) DestroyIcon(n.Big);
      n.Small = small; n.Big = big; n.Icon = icon;
    }
    string taskbar = appId == null ? null : appId + "|" + cmd + "|" + label + "|" + icon;
    if (taskbar != n.Taskbar) {
      // Clear first: the taskbar only reads the icon again when the id changes.
      if (n.Taskbar != null) SetAppId(h, null, null, null, null);
      if (appId != null) SetAppId(h, appId, cmd, label, icon == null ? null : icon + ",0");
      n.Taskbar = taskbar;
    }
  }

  static void SetIcons(IntPtr h, IntPtr small, IntPtr big) {
    IntPtr r;
    SendMessageTimeout(h, WM_SETICON, (IntPtr)0, small, SMTO_ABORTIFHUNG, 1000, out r); // ICON_SMALL
    SendMessageTimeout(h, WM_SETICON, (IntPtr)1, big, SMTO_ABORTIFHUNG, 1000, out r);   // ICON_BIG
  }

  // The window's own taskbar identity (System.AppUserModel.*). null id = back to its app's.
  static void SetAppId(IntPtr h, string id, string cmd, string label, string icon) {
    IPropertyStore ps;
    if (SHGetPropertyStoreForWindow(h, ref IID_IPropertyStore, out ps) != 0) return;
    try {
      // Relaunch details first, the id last: the taskbar reads them when the id changes.
      string[] values = { cmd, icon, label, id };
      uint[] keys = { 2, 3, 4, 5 }; // RelaunchCommand, RelaunchIconResource, RelaunchDisplayNameResource, ID
      for (int i = 0; i < keys.Length; i++) {
        PROPERTYKEY k; k.fmtid = AppUserModel; k.pid = keys[i];
        PROPVARIANT v = new PROPVARIANT();
        if (id != null && values[i] != null) { v.vt = 31; v.p = Marshal.StringToCoTaskMemUni(values[i]); } // VT_LPWSTR
        ps.SetValue(ref k, ref v);
        if (v.vt != 0) PropVariantClear(ref v);
      }
      ps.Commit();
    } finally { Marshal.ReleaseComObject(ps); }
  }

  static void Plain(IntPtr h) {
    Named n;
    lock (sync) {
      if (!named.TryGetValue(h.ToInt64(), out n)) return;
      named.Remove(h.ToInt64());
    }
    if (IsWindow(h)) {
      if (n.Taskbar != null) SetAppId(h, null, null, null, null);
      if (n.Icon != null) SetIcons(h, IntPtr.Zero, IntPtr.Zero);
      if (n.Title != null && TitleOf(h) == n.Title) SetTitle(h, n.Before);
    }
    if (n.Small != IntPtr.Zero) DestroyIcon(n.Small);
    if (n.Big != IntPtr.Zero) DestroyIcon(n.Big);
  }

  static void PlainAll() {
    List<long> keys;
    lock (sync) keys = new List<long>(named.Keys);
    foreach (long k in keys) Plain(new IntPtr(k));
  }

  static void Loop(ManualResetEvent ready) {
    SetThreadDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: physical pixels throughout
    threadId = GetCurrentThreadId();
    onEvent = OnEvent; onSoon = OnSoon; onTick = OnTick; onWindow = OnWindow;
    // foreground; move/size start-end; minimize start-end; destroy, show, hide, reorder; location, name; cloaked, uncloaked
    uint[][] ranges = {
      new uint[] { 0x0003, 0x0003 }, new uint[] { 0x000A, 0x000B }, new uint[] { 0x0016, 0x0017 },
      new uint[] { 0x8001, 0x8004 }, new uint[] { 0x800B, 0x800C }, new uint[] { 0x8017, 0x8018 },
    };
    foreach (uint[] r in ranges) hooks.Add(SetWinEventHook(r[0], r[1], IntPtr.Zero, onEvent, 0, 0, 0x0002)); // out of context, skip own process
    SetTimer(IntPtr.Zero, IntPtr.Zero, 1000, onTick); // a slow safety net for anything the events miss
    ready.Set();
    MSG m;
    while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) {
      if (m.message == WM_APP) Soon(1);
      else if (m.message == WM_RAISE) Raise(m.wParam);
      else DispatchMessage(ref m);
    }
    foreach (IntPtr h in hooks) UnhookWinEvent(h);
  }

  static void OnEvent(IntPtr hook, uint ev, IntPtr h, int obj, int child, uint thread, uint time) {
    if (ev >= 0x8000) {
      if (obj != 0 || child != 0 || h == IntPtr.Zero) return; // whole windows only, not carets or cursors
      if (ev == 0x800C) { KeepTitle(h); return; }
      if (ev == 0x8001) Forget(h);
      if (ev != 0x8001 && GetAncestor(h, 2) != h) return;      // and only top-level ones (GA_ROOT)
      bool skipped;
      lock (sync) skipped = skip.Contains(h.ToInt64());
      if (skipped) return;
    }
    if (ev == 0x000A || ev == 0x000B) {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      bool followed;
      lock (sync) followed = pids.Contains(pid);
      if (followed) {
        if (ev == 0x000A) moving.Add(h.ToInt64());
        else moving.Remove(h.ToInt64());
      }
      Soon(1);
      return;
    }
    Soon(16);
  }

  // Claude may set its own title again (a reload, a chat renamed): remember it,
  // then give the account's name back. A followed window's title is reported.
  static void KeepTitle(IntPtr h) {
    Named n;
    string want = null;
    lock (sync) {
      if (named.TryGetValue(h.ToInt64(), out n)) want = n.Title;
    }
    if (want != null) {
      string now = TitleOf(h);
      if (now != want) {
        lock (sync) { n.Own = now; n.Before = now; }
        SetTitle(h, want);
      }
    }
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    bool followed;
    lock (sync) followed = pids.Contains(pid);
    if (followed) Soon(16);
  }

  // Brings a window to the front, as a click on its taskbar button would. Windows
  // lets only the app in use do that: the island has just been clicked, so this
  // thread borrows the input state of the window with focus for the moment it takes.
  static void Raise(IntPtr h) {
    bool ok = false;
    if (IsWindow(h)) {
      if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
      uint pid;
      uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
      uint me = GetCurrentThreadId();
      bool joined = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
      BringWindowToTop(h);
      ok = SetForegroundWindow(h);
      if (joined) AttachThreadInput(me, fg, false);
      ok = ok || GetAncestor(GetForegroundWindow(), 3) == h;
    }
    Console.Out.WriteLine("{\"raised\":" + h.ToInt64() + ",\"ok\":" + (ok ? "true" : "false") + "}");
    Console.Out.Flush();
  }

  // A closed window takes its properties with it; only the icons are ours to free.
  static void Forget(IntPtr h) {
    Named n;
    lock (sync) {
      if (!named.TryGetValue(h.ToInt64(), out n)) return;
      named.Remove(h.ToInt64());
    }
    if (n.Small != IntPtr.Zero) DestroyIcon(n.Small);
    if (n.Big != IntPtr.Zero) DestroyIcon(n.Big);
  }

  // Many events arrive in bursts (a window being dragged); look once they settle.
  static void Soon(uint ms) {
    if (soonTimer != IntPtr.Zero) return;
    soonTimer = SetTimer(IntPtr.Zero, IntPtr.Zero, ms, onSoon);
  }

  static void OnSoon(IntPtr h, uint msg, IntPtr id, uint time) {
    KillTimer(IntPtr.Zero, id);
    soonTimer = IntPtr.Zero;
    Compute();
  }

  static void OnTick(IntPtr h, uint msg, IntPtr id, uint time) {
    Compute();
  }

  static void Compute() {
    lock (sync) { passPids = new HashSet<uint>(pids); passSkip = new HashSet<long>(skip); passZone = zone; passHasZone = hasZone; }
    above = new List<RECT>();
    json = new StringBuilder("{\"wins\":[");
    first = true;
    under = "null";
    if (passPids.Count > 0 || passHasZone) EnumWindows(onWindow, IntPtr.Zero);
    // The window with focus, or the one owning the menu or dialog that has it.
    json.Append("],\"fg\":").Append(GetAncestor(GetForegroundWindow(), 3).ToInt64());
    json.Append(",\"under\":").Append(under).Append('}');
    string s = json.ToString();
    if (s == last) return;
    last = s;
    Console.Out.WriteLine(s);
    Console.Out.Flush();
  }

  static bool OnWindow(IntPtr h, IntPtr l) {
    if (!IsWindowVisible(h) || passSkip.Contains(h.ToInt64())) return true;
    int cloaked;
    if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true; // another virtual desktop
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    bool followed = passPids.Contains(pid) && IsMainWindow(h);
    if (IsIconic(h)) {
      if (followed) Add(h, pid, new RECT(), null, true, false);
      return true;
    }
    RECT r;
    if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0 && !GetWindowRect(h, out r)) return true;
    if (r.R <= r.L || r.B <= r.T) return true;
    if (followed) Add(h, pid, r, Uncovered(r), false, IsZoomed(h));
    int ex = GetWindowLong(h, GWL_EXSTYLE);
    if ((ex & WS_EX_TRANSPARENT) != 0 && (ex & WS_EX_LAYERED) != 0) return true; // click-through overlays hide nothing
    above.Add(r);
    // The first (topmost) app window over the island's area: [handle, pid, l, t, r, b]. The desktop,
    // and overlays, tooltips and popups (tool windows, windows that never take focus) don't count.
    if (passHasZone && under == "null" && r.L < passZone.R && r.R > passZone.L && r.T < passZone.B && r.B > passZone.T
        && (ex & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) == 0 && !IsDesktop(h)) {
      under = "[" + h.ToInt64() + "," + pid + "," + r.L + "," + r.T + "," + r.R + "," + r.B + "]";
    }
    return true;
  }

  static bool IsDesktop(IntPtr h) {
    StringBuilder c = new StringBuilder(64);
    GetClassName(h, c, 64);
    string n = c.ToString();
    return n == "Progman" || n == "WorkerW" || n == "Shell_TrayWnd" || n == "Shell_SecondaryTrayWnd";
  }

  // Claude's own window, not its menus, popups or quick-entry panel.
  static bool IsMainWindow(IntPtr h) {
    if (GetWindow(h, 4) != IntPtr.Zero) return false; // GW_OWNER: owned popups
    if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return false;
    if ((GetWindowLong(h, GWL_STYLE) & WS_THICKFRAME) == 0) return false;
    StringBuilder c = new StringBuilder(64);
    GetClassName(h, c, 64);
    return c.ToString() == "Chrome_WidgetWin_1";
  }

  static List<RECT> Uncovered(RECT r) {
    List<RECT> cur = new List<RECT> { r };
    foreach (RECT o in above) {
      if (o.R <= r.L || o.L >= r.R || o.B <= r.T || o.T >= r.B) continue;
      List<RECT> next = new List<RECT>();
      foreach (RECT c in cur) Cut(c, o, next);
      cur = next;
      if (cur.Count == 0) break;
    }
    return cur;
  }

  // c minus o, as up to four rectangles.
  static void Cut(RECT c, RECT o, List<RECT> into) {
    if (o.R <= c.L || o.L >= c.R || o.B <= c.T || o.T >= c.B) { into.Add(c); return; }
    int t = Math.Max(c.T, o.T), b = Math.Min(c.B, o.B);
    if (o.T > c.T) into.Add(Rc(c.L, c.T, c.R, o.T));
    if (o.B < c.B) into.Add(Rc(c.L, o.B, c.R, c.B));
    if (o.L > c.L) into.Add(Rc(c.L, t, o.L, b));
    if (o.R < c.R) into.Add(Rc(o.R, t, c.R, b));
  }

  static RECT Rc(int l, int t, int r, int b) {
    RECT x;
    x.L = l; x.T = t; x.R = r; x.B = b;
    return x;
  }

  static void Add(IntPtr h, uint pid, RECT f, List<RECT> vis, bool min, bool max) {
    if (!first) json.Append(',');
    first = false;
    // Claude's own title for it (null: unknown), and whether it is layered, as Claude's main window is.
    string own;
    lock (sync) {
      Named n;
      own = named.TryGetValue(h.ToInt64(), out n) ? n.Own : null;
      if (n == null) own = TitleOf(h);
    }
    json.Append("{\"h\":").Append(h.ToInt64()).Append(",\"p\":").Append(pid)
      .Append(",\"min\":").Append(min ? 1 : 0).Append(",\"max\":").Append(max ? 1 : 0)
      .Append(",\"mv\":").Append(moving.Contains(h.ToInt64()) ? 1 : 0)
      .Append(",\"ly\":").Append((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_LAYERED) != 0 ? 1 : 0)
      .Append(",\"t\":");
    Str(json, own);
    json.Append(",\"f\":[").Append(f.L).Append(',').Append(f.T).Append(',').Append(f.R).Append(',').Append(f.B).Append("],\"v\":[");
    if (vis != null) {
      for (int i = 0; i < vis.Count; i++) {
        if (i > 0) json.Append(',');
        json.Append('[').Append(vis[i].L).Append(',').Append(vis[i].T).Append(',').Append(vis[i].R).Append(',').Append(vis[i].B).Append(']');
      }
    }
    json.Append("]}");
  }

  // A JSON string, kept to ASCII.
  static void Str(StringBuilder b, string s) {
    if (s == null) { b.Append("null"); return; }
    b.Append('"');
    foreach (char c in s) {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < 0x20 || c > 0x7E) b.Append("\\u").Append(((int)c).ToString("x4"));
      else b.Append(c);
    }
    b.Append('"');
  }
}
`;

let child = null;
let listener = null;
let buffer = '';
let sent = '';
let plainWaiters = [];
const raising = new Map(); // window handle -> callbacks waiting for it to come up

/**
 * Starts the helper (once). `onReport({ wins, fg, under })` gets every change:
 * for each window its handle, process id, minimized / maximized / being moved,
 * the title Claude gave it (`t`, null when unknown), whether it is layered as
 * Claude's main window is (`ly`), its frame [l, t, r, b] and its uncovered
 * parts, all in physical screen pixels; the handle of the window with focus;
 * and the topmost window over the island's area as [handle, pid, l, t, r, b], or null.
 */
function start(onReport) {
  listener = onReport;
  if (child) return;
  const encoded = Buffer.from(BOOT, 'utf16le').toString('base64');
  const me = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  child = me;
  buffer = '';
  sent = '';
  me.stdout.setEncoding('utf8');
  me.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.error) log('window tracker failed', msg.error);
      else if (msg.plain) settlePlain();
      else if (msg.raised) settleRaise(msg.raised, msg.ok === true);
      else if (msg.wins && listener && child === me) listener({ wins: msg.wins, fg: msg.fg || 0, under: msg.under || null });
    }
  });
  me.on('exit', () => {
    if (child === me) child = null;
    settlePlain();
    for (const h of [...raising.keys()]) settleRaise(h, false);
  });
  me.on('error', (e) => log('window tracker could not start', e.message));
  me.stdin.on('error', () => {});
  me.stdin.write(`${CS}\n//END\n`);
}

function write(line) {
  if (!child) return;
  try { child.stdin.write(`${line}\n`); } catch {}
}

/**
 * Follow the main windows of these processes, never count `skip` windows as
 * covering one, and report what lies over `zone` ([l, t, r, b], physical px).
 */
function watch(pids, skip, zone) {
  const line = `pids=${pids.join(',')};skip=${skip.join(',')}${zone ? `;zone=${zone.map(Math.round).join(',')}` : ''}`;
  if (!child || line === sent) return;
  sent = line;
  write(line);
}

const b64 = (s) => (s == null || s === '' ? '-' : Buffer.from(String(s), 'utf8').toString('base64'));

/**
 * Names one window: { title, icon (.ico path), appId, relaunch, relaunchName }.
 * A missing appId keeps the window on its app's own taskbar button.
 */
function name(h, n) {
  write(['name', h, b64(n.title), b64(n.icon), b64(n.appId), b64(n.relaunch), b64(n.relaunchName)].join(' '));
}

/** Puts one window back as it was. */
function plain(h) {
  write(`plain ${h}`);
}

function settlePlain() {
  const w = plainWaiters;
  plainWaiters = [];
  for (const f of w) f();
}

/** Puts every window back; resolves once the helper has done it (or after `ms`). */
function plainAll(ms = 1500) {
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    plainWaiters.push(() => { clearTimeout(t); resolve(); });
    write('plainall');
  });
}

function settleRaise(h, ok) {
  const w = raising.get(h) || [];
  raising.delete(h);
  for (const f of w) f(ok);
}

/** Brings a window to the front; resolves whether it got there. */
function raise(h, ms = 1500) {
  if (!child) return Promise.resolve(false);
  return new Promise((resolve) => {
    const t = setTimeout(() => settleRaise(h, false), ms);
    const list = raising.get(h) || [];
    list.push((ok) => { clearTimeout(t); resolve(ok); });
    raising.set(h, list);
    write(`raise ${h}`);
  });
}

function stop() {
  if (!child) return;
  const c = child;
  child = null;
  try { c.stdin.end(); } catch {} // the helper puts every window back before it exits
  setTimeout(() => { try { c.kill(); } catch {} }, 1500);
}

module.exports = { start, watch, name, plain, plainAll, raise, stop };
