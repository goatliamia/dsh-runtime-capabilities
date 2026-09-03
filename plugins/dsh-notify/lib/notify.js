// lib/notify.js — best-effort OS notification (with optional sound) for dsh-notify.
//
// The plugin runs inside the DeepSeek Harness host (Node), and the user is
// usually looking at a different window/browser tab, so we pop a real OS
// notification instead of only writing to stdout.
//
//   * Windows: spawns Windows PowerShell (powershell.exe, ships with the OS)
//     which raises a tray balloon that Windows 10/11 surfaces as a toast in
//     the notification center, and plays a system .wav (defaulting to the
//     "Windows Notify System Generic" sound) or falls back to a beep.
//     The script is passed via -EncodedCommand (UTF-16LE base64) so titles
//     and bodies never need shell quoting/escaping.
//   * macOS: `osascript` `display notification … with sound name "Glass"`.
//   * Linux/other: `notify-send` when present; otherwise a console bell.
//
// Every failure is swallowed and reported through the returned status; the
// agent loop must never be affected by a notification hiccup.

import { spawn } from "node:child_process";
import { platform } from "node:os";

/** Default Windows sounds, tried in order. */
const DEFAULT_WINDOWS_SOUNDS = [
  "Windows Notify System Generic.wav",
  "Windows Notify Messaging.wav",
  "Windows Notify.wav",
  "notify.wav",
  "chimes.wav",
  "ding.wav",
  "tada.wav",
];

/** Never run more than this many notification helper processes at once. */
const MAX_CONCURRENT = 3;

let inflight = 0;
const pendingQueue = [];

/** Escape a JS string for embedding as a single-quoted PowerShell literal. */
function psQuote(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

/**
 * Turn a PowerShell script into an -EncodedCommand argument.
 * Exported as an internal/test aid together with {@link windowsScript}.
 */
export function psEncoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** PowerShell code that plays the alert sound, never throwing outward. */
function psSoundBlock({ sound, soundFile }) {
  if (!sound) return "";
  const candidates = [];
  if (soundFile) candidates.push(psQuote(String(soundFile)));
  for (const name of DEFAULT_WINDOWS_SOUNDS) {
    candidates.push(psQuote(`$env:WINDIR\\Media\\${name}`));
  }
  return `
    try {
      Add-Type -AssemblyName System.Media
      $candidatePaths = @(${candidates.join(", ")})
      $wavPath = $null
      foreach ($candidate in $candidatePaths) {
        if (Test-Path -LiteralPath $candidate) { $wavPath = $candidate; break }
      }
      if ($wavPath) {
        $player = New-Object System.Media.SoundPlayer $wavPath
        $player.PlaySync()
        $player.Dispose()
      } else {
        [System.Media.SystemSounds]::Asterisk.Play()
        Start-Sleep -Milliseconds 700
      }
    } catch {
      try { [Console]::Beep(880, 200) } catch {}
      try { [Console]::Beep(1175, 320) } catch {}
    }
  `;
}

/**
 * Build the full Windows PowerShell script for one notification.
 * Exported as an internal/test aid so the exact command can be inspected or
 * replayed; the public entry point remains {@link notify}.
 */
export function windowsScript({ title, body, sound, soundFile, balloonMs }) {
  const lifetimeMs = balloonMs + 2500;
  return `
$ErrorActionPreference = 'Stop'
$started = [DateTime]::UtcNow
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $n = New-Object System.Windows.Forms.NotifyIcon
  $n.Icon = [System.Drawing.SystemIcons]::Information
  $n.Visible = $true
  $n.Text = 'DeepSeek Harness'
  $n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $n.BalloonTipTitle = ${psQuote(title)}
  $n.BalloonTipText = ${psQuote(body)}
  $n.ShowBalloonTip(${Math.max(0, Math.round(balloonMs))})
} catch {
  try { [Console]::Error.WriteLine(('dsh-notify toast failed: ' + $_.Exception.Message)) } catch {}
}
${psSoundBlock({ sound, soundFile })}
# Keep the process alive long enough for the balloon to be surfaced
# (ShowBalloonTip posts a message the tray needs time to deliver).
$leftMs = (${lifetimeMs}) - ([DateTime]::UtcNow - $started).TotalMilliseconds
if ($leftMs -gt 0) { Start-Sleep -Milliseconds ([int]$leftMs) }
try { $n.Dispose() } catch {}
`;
}

/** macOS notification via osascript. */
function notifyMacOS({ title, body, sound }) {
  const expr = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`
    + (sound ? ` sound name "Glass"` : "");
  return spawn("osascript", ["-e", expr], { stdio: "ignore" });
}

/**
 * Raise an OS notification. Never rejects.
 *
 * @param {object} options
 * @param {string} options.title   - notification title (short).
 * @param {string} options.body    - notification body text.
 * @param {boolean} [options.sound=true] - whether to play an alert sound.
 * @param {string}  [options.soundFile]   - optional explicit path to a .wav.
 * @param {number}  [options.balloonMs=8000] - display lifetime hint (ms).
 * @returns {Promise<boolean>} resolves true when the notifier was launched.
 */
export function notify(options) {
  const opts = {
    title: "DeepSeek Harness",
    body: "",
    sound: true,
    balloonMs: 8000,
    ...options,
  };

  return new Promise((resolve) => {
    const run = () => {
      let child = null;
      try {
        if (platform() === "win32") {
          const script = windowsScript(opts);
          child = spawn(
            "powershell.exe",
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-EncodedCommand",
              psEncoded(script),
            ],
            { windowsHide: true, stdio: "ignore" },
          );
        } else if (platform() === "darwin") {
          child = notifyMacOS(opts);
        } else {
          child = spawn("notify-send", [opts.title, opts.body], { stdio: "ignore" });
        }
      } catch (error) {
        resolve(false);
        return;
      }

      inflight += 1;
      let settled = false;
      const settle = (ok) => {
        if (settled) return;
        settled = true;
        inflight -= 1;
        const next = pendingQueue.shift();
        if (next) next();
        resolve(ok);
      };

      child.once("spawn", () => settle(true));
      child.once("error", () => settle(false));

      // Never let a helper process outlive its usefulness.
      const killer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }, opts.balloonMs + 15000);
      killer.unref?.();
    };

    if (inflight >= MAX_CONCURRENT) {
      pendingQueue.push(run);
    } else {
      run();
    }
  });
}
