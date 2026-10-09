'use strict';
// Reports every claude.exe that starts with a claude:// link on its command
// line, about 0.1 s after it appears (a WMI process-creation event).
//
// Windows passes a claude:// link on by starting a short-lived Claude.exe
// "<link>" that hands it to the Main window. Claude needs well over a second to
// boot before it can do that, so a link seen here can still be kept away from
// Main. Runs only while an account is waiting for sign-in.

const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$q = "SELECT * FROM __InstanceCreationEvent WITHIN 0.1 WHERE TargetInstance ISA 'Win32_Process' AND TargetInstance.Name = 'claude.exe'"
Register-CimIndicationEvent -Query $q -SourceIdentifier FlockLinks | Out-Null
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
$parent = [int]$env:FLOCK_PARENT_PID
while ($true) {
  $e = Wait-Event -SourceIdentifier FlockLinks -Timeout 2
  if ($e) {
    $p = $e.SourceEventArgs.NewEvent.TargetInstance
    Remove-Event -EventIdentifier $e.EventIdentifier
    $cmd = [string]$p.CommandLine
    if ($cmd -match 'claude://') {
      [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ pid = [int]$p.ProcessId; exe = [string]$p.ExecutablePath; cmd = $cmd }))
      [Console]::Out.Flush()
    }
  }
  if ($parent -and -not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { break }
}
`;

/**
 * Starts watching. `onProcess({ pid, exe, cmd })` is called for each new
 * claude.exe whose command line holds a claude:// link.
 */
function start(onProcess) {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, FLOCK_PARENT_PID: String(process.pid) },
    },
  );
  let ready = false;
  let exited = false;
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) ready = true;
      else if (msg.pid) onProcess(msg);
    }
  });
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });
  return {
    isReady: () => ready && !exited,
    isAlive: () => !exited,
    stop() {
      if (exited) return;
      try { child.kill(); } catch {}
      exited = true;
    },
  };
}

module.exports = { start };
