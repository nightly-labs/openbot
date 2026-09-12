# Troubleshooting OpenBot

## OpenBot says agent CLI setup is required

Open Terminal and verify the CLI:

```bash
codex --version
```

If the command is missing, install Codex using the official installer:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

Then run `codex login`, sign in with ChatGPT, fully quit OpenBot, and open it again.

You can use Claude instead. Verify and install Claude CLI:

```bash
claude --version
curl -fsSL https://claude.ai/install.sh | bash
claude auth login
```

If Codex is installed in a non-standard location, launch OpenBot with `OPENBOT_CODEX_PATH` set to the
absolute Codex executable path.

For a non-standard Claude location, set `OPENBOT_CLAUDE_PATH` to the absolute Claude executable path.

## The Linux AppImage exits immediately

On Ubuntu 23.10 or newer and on Debian 13, unprivileged user namespaces are restricted by AppArmor.
The Electron sandbox is built on one, so OpenBot exits during launch and writes a message about the
SUID sandbox or a user namespace to the terminal.

Install the AppArmor profile that ships with OpenBot, then reload AppArmor:

```bash
sudo install -m 0644 build/linux/openbot.apparmor /etc/apparmor.d/openbot
sudo systemctl reload apparmor
```

The same file is inside the AppImage at `resources/linux/openbot.apparmor`. The profile attaches to
the usual places to keep an AppImage; if yours is somewhere else, edit the path in the profile before
you install it.

Do not start OpenBot with `--no-sandbox`. It is not a supported workaround. The sandbox is the
boundary between a web renderer and the rest of your computer, and OpenBot gives its agents full
local access on the other side of it.

## Voice prompts or remote desktop are missing on Linux

Neither is available in the Linux build. The Whisper transcription binary and the Sunshine remote
desktop runtime are built for macOS and Windows only, so the microphone control is not drawn and
remote desktop reports itself as unavailable. Everything else works as it does on the other
platforms.

## Computer Use is unavailable

Computer Use requires a compatible local Codex plugin plus macOS Screen Recording and Accessibility
permissions. Open **System Settings → Privacy & Security**, grant the permissions requested by the
plugin, then restart OpenBot. OpenBot does not bypass macOS prompts or plugin safety hand-offs.

## A chat is missing after an update

Do not follow the reset steps below. Your messages are stored in one SQLite file, nothing copies it
before an upgrade, and moving that folder puts the only copy out of reach.

Quit OpenBot and start it again first. On launch OpenBot gives a chat back to the agent it belongs to
when an agent and its chat lose track of each other, so a restart recovers most cases on its own.

If the chat is still missing, quit OpenBot and read the file directly. This reports chats that no
agent currently claims, and the number of messages waiting in each:

```sh
sqlite3 "$HOME/Library/Application Support/OpenBot/openbot.db" \
  "SELECT t.thread_id, t.agent_id, (SELECT count(*) FROM projection_thread_messages m
     WHERE m.thread_id = t.thread_id) AS messages
   FROM projection_threads t
   LEFT JOIN projection_agents a ON a.agent_id = t.agent_id
   WHERE a.agent_id IS NULL;"
```

Any row means the messages are still on disk and are recoverable. Report the output with the details
below, and keep the folder where it is until then.

## OpenBot will not start and names a stored agent profile

The message reads `Stored agent profile <id> has an unreadable "<field>" value`. Your data is intact:
OpenBot stops before it writes anything, which is what keeps the profile as it is.

Do not follow the reset steps below, and do not move the folder. Install the current version first:
OpenBot now repairs a stored profile field it cannot read and keeps the agent, its chat and its
workspace, while a release from before that repair refuses to start over the same profile.

If the current version still stops, quit OpenBot and read the profile it names. On macOS:

```sh
sqlite3 "$HOME/Library/Application Support/OpenBot/openbot.db" \
  "SELECT agent_json FROM projection_agents WHERE agent_id = '<id>';"
```

On Windows, the same file is at `%APPDATA%\OpenBot\openbot.db`.

Report the field the message names, together with the details below. The output holds your own file
paths, so review it before you publish it.

## Reset OpenBot

Quit OpenBot before moving data. To reset application state and the shared browser profile while
keeping agent workspaces, move this folder somewhere safe:

```text
~/Library/Application Support/OpenBot
```

To also reset agent workspaces, managed transfers, and downloads, move this folder as well:

```text
~/OpenBot
```

OpenBot creates fresh folders on the next launch. Review and back up their contents first. Do not
remove `~/.codex` or `~/.claude` unless you intentionally want to manage CLI login and history.

## Uninstall

Quit OpenBot. On macOS remove `OpenBot.app` from Applications; on Windows use the installer's
uninstaller; on Linux delete the AppImage, and `/etc/apparmor.d/openbot` if you installed the
profile. If you also want to remove local OpenBot
data, follow the reset steps above. Agent CLIs and their data are independent and are not removed
with OpenBot.

## Report a problem

Use [GitHub Issues](https://github.com/NorbertBodziony/openbot/issues) for reproducible bugs. Include
the OpenBot version, the operating system and its version, the hardware, the provider and CLI
version, and minimal reproduction steps. Never publish tokens, `~/.codex`, `~/.claude`, conversations, private files,
Electron user data, or full unreviewed diagnostics.
