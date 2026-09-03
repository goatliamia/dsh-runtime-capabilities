# dsh-notify

A DeepSeek Harness (DSH) **host plugin** that notifies you — with sound by
default — every time the AI finishes a conversation turn. If you usually work
in another browser tab or window while DSH runs long tasks, this pops a real
OS notification the moment the agent stops running, so you don't have to keep
watching the page.

## What triggers a notification

DSH keeps every conversation as an append-only session event log, and the
agent loop brackets each AI turn with `turn/start` … `turn/end` events. The
plugin listens to the `session/event` hook and, when a turn ends, notifies you
for these end reasons (configurable):

| Reason       | Meaning                              |
| ------------ | ------------------------------------ |
| `completed`  | AI finished answering normally       |
| `error`      | The turn failed                      |
| `max-tokens` | The turn hit the output-token limit  |
| `blocked`    | The turn stopped and needs attention |

Turns ended by cancellation (`aborted`) or by crash replay (`interrupted`) are
ignored, and internal sessions that never talked to a human directly
(subagents, scheduled/plugin-injected work) never notify — so a main task that
fans out to subagents produces one notification, not a burst.

## Files

```
package.json        plugin package + bundle patch pointer
cordis.patch.yml    inserts the `notify` plugin row (id: notify)
lib/index.js        the host plugin: event listening + filtering + composition
lib/notify.js       OS notification with sound (Windows toast, macOS, Linux)
```

## Installing / loading in a profile

`dsh-notify` is a **bundle**: its `cordis.patch.yml` inserts the plugin row into
a profile's composed Cordis tree. To use it in a profile (for example
`profiles/<name>`):

1. Link the package into the profile:

   ```jsonc
   // <profile>/package.json
   {
     "dependencies": {
       "dsh-notify": "file:<path-to>/rn-a-ws"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-headless",
           "dsh-notify"        // ← add the bundle
         ]
       }
     }
   }
   ```

2. Re-run the profile composition (regenerates `cordis.yml` from the bundle
   patches) or apply the workspace `cordis.patch.yml` as a `--patch` overlay.
   The plugin row is then loaded from `dsh-notify`'s `lib/index.js`.

If you only want the plugin without the bundle packaging, the row in
`cordis.patch.yml` is equivalent to:

```yaml
- id: notify
  name: 'dsh-notify'
```

## Configuration

The plugin row accepts an optional `config`. All keys are optional:

```yaml
- id: notify
  name: 'dsh-notify'
  config:
    enabled: true            # master switch
    sound: true              # play an alert sound with the toast
    soundFile: ~             # optional explicit .wav path override
    reasons:                 # end reasons that notify (empty = none)
      - completed
      - error
      - max-tokens
      - blocked
    onlyDirectConversations: true   # skip subagent/plugin-only sessions
    minTurnMs: 250           # ignore instant no-op turns (0 = every turn)
    previewChars: 160        # notification body preview length cap
    balloonMs: 8000          # how long the toast stays visible
    title: ~                 # fixed notification title override
```

Example — silent toasts only when the AI errors out:

```yaml
config:
  sound: false
  reasons: [error]
```

## Notification & sound details

* **Windows** — the plugin spawns the built-in Windows PowerShell
  (`powershell.exe`) with an `-EncodedCommand` script that raises a tray
  balloon, which Windows 10/11 surfaces as a toast in the notification center,
  and plays `C:\Windows\Media\Windows Notify System Generic.wav` (falling back
  to `Messaging`/`notify`/`chimes`/… or `SystemSounds.Asterisk`/beeps).
  The command is UTF‑16LE base64 encoded, so titles and bodies need no quoting.
* **macOS** — `osascript` `display notification … sound name "Glass"`.
* **Linux** — `notify-send` when present; otherwise a console bell.
* If no notifier can be started the plugin logs a warning and the agent loop is
  unaffected.

### Troubleshooting

* The notification appears on the machine where the DSH host runs. If you are
  using the browser UI against a remote host, install/load the plugin on that
  host (or configure that host's OS to surface its toasts).
* Windows **Focus Assist** can silently suppress toasts — allow
  "DeepSeek Harness"/PowerShell or disable Focus Assist while waiting.
* The DSH host process must run in your interactive desktop session (not as a
  Windows service in session 0) for the toast to be visible.
* To pick a different alert, point `config.soundFile` at any `.wav`, e.g.
  `C:\Windows\Media\Alarm03.wav`.

## Development

```bash
node --check lib/index.js && node --check lib/notify.js   # syntax
```

The notifier can be exercised directly:

```bash
node --input-type=module -e "const {notify}=await import('./lib/notify.js'); console.log(await notify({title:'dsh-notify',body:'test',sound:true}))"
```
