'use strict';
// Runs a program in a pseudo-console (Windows ConPTY), so it behaves as it
// would in a terminal window. Claude Code only asks some questions there, such
// as whether to trust a folder; with plain pipes it gives up instead. Node
// can't create a pseudo-console without a native module, so a small C# class
// runs inside one long-lived PowerShell, as in wintrack.js. Each program also
// runs in a job object, so stopping it stops everything it started, and
// nothing outlives the helper if Flock goes away.
//
// Commands go in and events come out as lines of space-separated fields, with
// free text base64-encoded (PowerShell's stdin would mangle anything that
// isn't ASCII):
//   in:  start <id> <cmdline> <cwd> <env block> <cols> <rows> | write <id> <bytes> | kill <id>
//   out: ready | started <id> <pid> | data <id> <bytes> | exit <id> <code> | error <id> <message>

const { spawn } = require('child_process');
const { log } = require('./log');

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
  [Console]::Out.WriteLine('fail ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_)))
  [Console]::Out.Flush()
  exit
}
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($null -eq $l) { break }
  [FlockPty]::Command($l)
}
[FlockPty]::StopAll()
`;

// Kept to plain ASCII: it travels through PowerShell's stdin.
const CS = String.raw`
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public static class FlockPty {
  [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars;
    public int dwFillAttribute; public int dwFlags; public short wShowWindow; public short cbReserved2;
    public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] public struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS { public ulong R, W, O, RB, WB, OB; }
  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION Basic; public IO_COUNTERS Io;
    public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
  }

  [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(COORD size, IntPtr hInput, IntPtr hOutput, uint flags, out IntPtr hPC);
  [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr hPC);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr hRead, out IntPtr hWrite, IntPtr attrs, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr retSize);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr hThread);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr hProcess, uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr hProcess, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int size);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr hProcess);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);

  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  const uint CREATE_SUSPENDED = 0x00000004;
  const uint KILL_ON_JOB_CLOSE = 0x00002000;
  const int STARTF_USESTDHANDLES = 0x00000100;
  static readonly IntPtr PSEUDOCONSOLE_ATTR = (IntPtr)0x00020016;

  class Term { public IntPtr PC, Process, Job, Attrs; public FileStream Input; public Thread Reader; }
  static readonly Dictionary<string, Term> terms = new Dictionary<string, Term>();
  static readonly object outLock = new object();

  static void Emit(string line) { lock (outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); } }
  static string Text(string b64) { return b64 == "-" ? "" : Encoding.UTF8.GetString(Convert.FromBase64String(b64)); }
  static string B64(string s) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(s)); }

  public static void Command(string line) {
    string[] p = line.Split(' ');
    string id = p.Length > 1 ? p[1] : "-";
    try {
      if (p[0] == "start") Start(id, Text(p[2]), Text(p[3]), Text(p[4]), short.Parse(p[5]), short.Parse(p[6]));
      else if (p[0] == "write") Write(id, Convert.FromBase64String(p[2]));
      else if (p[0] == "kill") Kill(id);
    } catch (Exception e) {
      Emit("error " + id + " " + B64(e.Message));
    }
  }

  static void Start(string id, string cmd, string cwd, string env, short cols, short rows) {
    IntPtr inRead, inWrite, outRead, outWrite, pc;
    if (!CreatePipe(out inRead, out inWrite, IntPtr.Zero, 0)) throw new Exception("CreatePipe failed (" + Marshal.GetLastWin32Error() + ")");
    if (!CreatePipe(out outRead, out outWrite, IntPtr.Zero, 0)) throw new Exception("CreatePipe failed (" + Marshal.GetLastWin32Error() + ")");
    COORD size = new COORD(); size.X = cols; size.Y = rows;
    int hr = CreatePseudoConsole(size, inRead, outWrite, 0, out pc);
    CloseHandle(inRead); CloseHandle(outWrite); // the pseudo-console keeps its own copies
    if (hr != 0) { CloseHandle(inWrite); CloseHandle(outRead); throw new Exception("This Windows has no pseudo-console (0x" + hr.ToString("X") + ")"); }

    IntPtr attrSize = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrSize);
    IntPtr attrs = Marshal.AllocHGlobal(attrSize);
    InitializeProcThreadAttributeList(attrs, 1, 0, ref attrSize);
    UpdateProcThreadAttribute(attrs, 0, PSEUDOCONSOLE_ATTR, pc, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero);

    STARTUPINFOEX si = new STARTUPINFOEX();
    si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
    // Empty standard handles: otherwise the program inherits this helper's
    // redirected stdin/stdout instead of talking to the pseudo-console.
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.lpAttributeList = attrs;
    IntPtr envBlock = env.Length > 0 ? Marshal.StringToHGlobalUni(env) : IntPtr.Zero;
    PROCESS_INFORMATION pi;
    bool ok = CreateProcessW(null, new StringBuilder(cmd), IntPtr.Zero, IntPtr.Zero, false,
      EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED,
      envBlock, cwd.Length > 0 ? cwd : null, ref si, out pi);
    int err = Marshal.GetLastWin32Error();
    if (envBlock != IntPtr.Zero) Marshal.FreeHGlobal(envBlock);
    if (!ok) {
      ClosePseudoConsole(pc); CloseHandle(inWrite); CloseHandle(outRead);
      DeleteProcThreadAttributeList(attrs); Marshal.FreeHGlobal(attrs);
      throw new Exception("Could not start the program (Windows error " + err + ")");
    }

    IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
    if (job != IntPtr.Zero) {
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      info.Basic.LimitFlags = KILL_ON_JOB_CLOSE;
      SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)));
      if (!AssignProcessToJobObject(job, pi.hProcess)) { CloseHandle(job); job = IntPtr.Zero; }
    }
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);

    Term t = new Term();
    t.PC = pc; t.Process = pi.hProcess; t.Job = job; t.Attrs = attrs;
    t.Input = new FileStream(new SafeFileHandle(inWrite, true), FileAccess.Write, 1, false);
    FileStream output = new FileStream(new SafeFileHandle(outRead, true), FileAccess.Read, 1, false);
    lock (terms) terms[id] = t;
    Emit("started " + id + " " + pi.dwProcessId);

    t.Reader = new Thread(() => {
      byte[] buf = new byte[16384];
      try {
        int n;
        while ((n = output.Read(buf, 0, buf.Length)) > 0) Emit("data " + id + " " + Convert.ToBase64String(buf, 0, n));
      } catch { }
      try { output.Dispose(); } catch { }
    });
    t.Reader.IsBackground = true;
    t.Reader.Start();

    Thread waiter = new Thread(() => {
      WaitForSingleObject(t.Process, 0xFFFFFFFF);
      uint code;
      if (!GetExitCodeProcess(t.Process, out code)) code = 1;
      ClosePseudoConsole(t.PC); // ends the output stream once what is left has been read
      t.Reader.Join(3000);
      lock (terms) terms.Remove(id);
      try { t.Input.Dispose(); } catch { }
      if (t.Job != IntPtr.Zero) CloseHandle(t.Job); // stops whatever the program left running
      CloseHandle(t.Process);
      DeleteProcThreadAttributeList(t.Attrs); Marshal.FreeHGlobal(t.Attrs);
      Emit("exit " + id + " " + code);
    });
    waiter.IsBackground = true;
    waiter.Start();
  }

  static Term Find(string id) { lock (terms) { Term t; return terms.TryGetValue(id, out t) ? t : null; } }

  static void Write(string id, byte[] data) {
    Term t = Find(id);
    if (t == null) return;
    t.Input.Write(data, 0, data.Length);
    t.Input.Flush();
  }

  static void Kill(string id) {
    Term t = Find(id);
    if (t == null) return;
    if (t.Job != IntPtr.Zero) TerminateJobObject(t.Job, 1);
    else TerminateProcess(t.Process, 1);
  }

  public static void StopAll() {
    List<string> ids;
    lock (terms) ids = new List<string>(terms.Keys);
    foreach (string id in ids) Kill(id);
  }
}
`;

let child = null;
let booting = null; // resolves once the helper is ready
let buffer = '';
let seq = 0;
const terms = new Map(); // id -> { started, failed, data, exit, decoder }

const b64 = (s) => (s == null || s === '' ? '-' : Buffer.from(String(s), 'utf8').toString('base64'));

function handle(line) {
  const [kind, id, a] = line.split(' ');
  if (kind === 'ready') return;
  const t = terms.get(id);
  if (!t) return;
  if (kind === 'started') t.started(Number(a) || null);
  else if (kind === 'data') t.data(t.decoder.decode(Buffer.from(a || '', 'base64'), { stream: true }));
  else if (kind === 'error') t.failed(new Error(Buffer.from(a || '', 'base64').toString('utf8')));
  else if (kind === 'exit') {
    terms.delete(id);
    t.exit(Number(a));
  }
}

function boot() {
  if (booting) return booting;
  booting = new Promise((resolve, reject) => {
    const encoded = Buffer.from(BOOT, 'utf16le').toString('base64');
    const me = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    child = me;
    buffer = '';
    me.stdout.setEncoding('utf8');
    me.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line === 'ready') resolve();
        else if (line.startsWith('fail ')) {
          const msg = Buffer.from(line.slice(5), 'base64').toString('utf8');
          log('terminal helper failed', msg);
          reject(new Error('Flock could not start its terminal helper.'));
        } else if (line) handle(line);
      }
    });
    me.on('exit', () => {
      if (child === me) { child = null; booting = null; }
      reject(new Error('Flock’s terminal helper stopped.'));
      for (const [id, t] of [...terms]) { terms.delete(id); t.exit(null); }
    });
    me.on('error', (e) => {
      log('terminal helper could not start', e.message);
      reject(e);
    });
    me.stdin.on('error', () => {});
    me.stdin.write(`${CS}\n//END\n`);
  });
  booting.catch(() => {});
  return booting;
}

function send(line) {
  if (!child) return;
  try { child.stdin.write(`${line}\n`); } catch {}
}

/** Quotes one argument the way CommandLineToArgvW reads it back. */
function quote(arg) {
  const s = String(arg);
  if (s && !/[\s"]/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/** "K=V\0K=V\0\0", sorted the way Windows expects an environment block. */
function envBlock(env) {
  const keys = Object.keys(env).filter((k) => k && !k.includes('=') && env[k] != null);
  keys.sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()));
  return `${keys.map((k) => `${k}=${env[k]}\0`).join('')}\0`;
}

/**
 * Starts `file args…` in a pseudo-console. Resolves to a terminal:
 * { pid, write(text), kill(), onData(cb(text)), onExit(cb(code)) }; code is
 * null when the helper itself went away.
 */
async function open({ file, args = [], cwd, env = process.env, cols = 200, rows = 50 }) {
  await boot();
  const id = `t${++seq}`;
  const dataCbs = [];
  const exitCbs = [];
  const backlog = []; // output that arrives before anyone listens
  let exited = null;
  return new Promise((resolve, reject) => {
    const term = {
      pid: null,
      write: (text) => send(`write ${id} ${Buffer.from(String(text), 'utf8').toString('base64')}`),
      kill: () => send(`kill ${id}`),
      onData(cb) {
        dataCbs.push(cb);
        while (backlog.length) cb(backlog.shift());
      },
      onExit(cb) {
        if (exited) cb(exited.code);
        else exitCbs.push(cb);
      },
    };
    terms.set(id, {
      decoder: new TextDecoder('utf-8'),
      started(pid) {
        term.pid = pid;
        resolve(term);
      },
      failed(e) {
        terms.delete(id);
        reject(e);
      },
      data(text) {
        if (!text) return;
        if (dataCbs.length) dataCbs.forEach((cb) => cb(text));
        else backlog.push(text);
      },
      exit(code) {
        exited = { code };
        exitCbs.forEach((cb) => cb(code));
        reject(new Error('The program stopped before it started.'));
      },
    });
    const cmd = [file, ...args].map(quote).join(' ');
    send(['start', id, b64(cmd), b64(cwd || ''), b64(envBlock(env)), cols, rows].join(' '));
  });
}

function stop() {
  if (!child) return;
  const c = child;
  child = null;
  booting = null;
  try { c.stdin.end(); } catch {} // the helper stops every program before it exits
  setTimeout(() => { try { c.kill(); } catch {} }, 1500);
}

module.exports = { open, stop, quote };
