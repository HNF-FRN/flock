'use strict';
// Lists running claude.exe processes with their command lines.
// Node has no API for other processes' command lines, so one PowerShell process
// stays alive and answers "scan" requests over stdin/stdout. Starting PowerShell
// for every scan would cost ~0.5 s of CPU each time.

const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $r = @(Get-CimInstance -ClassName Win32_Process -Filter "Name='claude.exe'" | ForEach-Object {
      $start = $null
      if ($_.CreationDate) { $start = $_.CreationDate.ToUniversalTime().ToString('o') }
      [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; exe = [string]$_.ExecutablePath; cmd = [string]$_.CommandLine; start = $start }
    })
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $r -Compress -Depth 3))
  } catch {
    [Console]::Out.WriteLine('{"error":' + (ConvertTo-Json -InputObject ([string]$_)) + '}')
  }
  [Console]::Out.Flush()
}
`;

const TIMEOUT_MS = 12000;

let child = null;
let buffer = '';
const waiting = [];

function start() {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const job = waiting.shift();
      if (!job) continue;
      clearTimeout(job.timer);
      try {
        const parsed = JSON.parse(line);
        if (parsed && parsed.error) job.reject(new Error(parsed.error));
        else job.resolve(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        job.reject(e);
      }
    }
  });
  const dead = child;
  child.on('exit', () => {
    if (child === dead) child = null;
    while (waiting.length) {
      const job = waiting.shift();
      clearTimeout(job.timer);
      job.reject(new Error('process scanner exited'));
    }
  });
  child.on('error', () => {});
}

/** Resolves to [{ pid, ppid, exe, cmd, start }] for every claude.exe. */
function scan() {
  if (!child) start();
  return new Promise((resolve, reject) => {
    const job = { resolve, reject, timer: null };
    job.timer = setTimeout(() => {
      const i = waiting.indexOf(job);
      if (i !== -1) waiting.splice(i, 1);
      reject(new Error('process scan timed out'));
      stop(); // a stuck helper is replaced on the next scan
    }, TIMEOUT_MS);
    waiting.push(job);
    try {
      child.stdin.write('scan\n');
    } catch (e) {
      clearTimeout(job.timer);
      waiting.splice(waiting.indexOf(job), 1);
      reject(e);
    }
  });
}

function stop() {
  if (!child) return;
  try { child.stdin.end(); } catch {}
  try { child.kill(); } catch {}
  child = null;
}

module.exports = { scan, stop };
