---
name: "Error Report"
description: "Find out what went wrong in OpenBot from the user's account, the OpenBot logs and a read-only look at openbot.db. Remove secrets and private data, write one Markdown report that the user can share with the OpenBot team, and open a prefilled GitHub bug form on request."
---

# Error Report

The user is often not technical. Use plain words. Do not show commands or raw logs unless they ask.

You only read. Do not fix code, change settings, agents or routines, or write to `openbot.db`. Do not post anything yourself.

## 1. Start without questions

A short request such as "make me a report" or "something broke" is enough. Do not ask questions first. Use what the user said, and find the rest yourself.

- The time window is what the user said, or else the last 24 hours. Log times are UTC: convert from the user's local time.
- In step 2, find each problem in the window: `ERROR` lines, failed routine runs, failed provider sessions, delivery errors, crashes, and turns that did not complete.
- Report the most recent problem that the user could see. Name each other problem in one line under "Other problems found", and offer a report for it.
- Ask one question only when you find no problem: "What went wrong, and about when?" Use `ask_user`.
- Do not ask for facts that you can read, such as the version, the provider, or the operating system.

## 2. Collect (read only)

Find the user data folder:

- macOS: `~/Library/Application Support/OpenBot`
- Windows: `%APPDATA%\OpenBot`
- Linux: `~/.config/OpenBot`

If it is not there, ask the user. Do not search the whole disk.

**Environment.** OpenBot version: on macOS `defaults read /Applications/OpenBot.app/Contents/Info.plist CFBundleShortVersionString`; otherwise ask (Settings → Updates). Operating system and processor: `sw_vers` and `uname -m`, `uname -sr`, or `ver`. Provider CLI: `<cli> --version` (for example `claude`, `codex`, `cursor-agent`).

**Logs** in `logs/`: `main/main.log`, `agents/agents.log`, `providers/providers.log`, `account/account.log`, `update/update.log`, `trace.ndjson`, and their rotated copies (`.1`, `.old`). Each line starts with a UTC time. Read only the lines in the window, plus a few minutes before it. Look for `ERROR` and `WARN` lines, `Quitting: <reason>.`, and trace lines with `"kind":"exit"`, `"kind":"crash"` or an `outcome` that is not `ok`. Log lines are already partly redacted (`[redacted]`); redact them again in step 4.

**Crash dumps.** If the `Crashpad` folder next to `logs` has files from the window, report the count and times only. Never copy or attach a dump: it can hold secrets.

**Database.** Open it read only, and never in another mode:

```sh
sqlite3 -readonly "file:<user data>/openbot.db?mode=ro"
```

Do not use `immutable=1`: it skips recent writes. Run `.schema <table>` first, and skip a table or column that an older version does not have. Use only these reads, limited to the window:

- Agent name and provider: `json_extract(agent_json, '$.name')`, `json_extract(agent_json, '$.provider')` from `projection_agents`.
- Routine runs: `routine_name`, `status`, `error`, `scheduled_for`, `updated_at` from `projection_routine_runs` where `status` is `failed`, `interrupted` or `needs-attention`.
- Turns: `status`, `started_at`, `completed_at` from `projection_turns` where `status` is not `completed`. Join `projection_threads` on `thread_id` for the `agent_id`.
- Provider sessions: `provider`, `state`, `updated_at` from `projection_provider_sessions` where `state` is `failed`.
- Message deliveries: `status`, `error`, `created_at` from `projection_deliveries` where `error` is not null.

Never select `message_json`, `instruction`, `delivery_json`, memory `text`, or a whole `agent_json`. They hold chats and private instructions. When `sqlite3` is missing or the database is busy, skip this part and say so in the report.

## 3. Diagnose

Use the Bug Triage skill. Find the first thing that went wrong, not only the last error. Give at most three causes, ranked by evidence. Mark each fact as confirmed (with its source), likely, or not checked.

When it is not an OpenBot bug, say so in plain words and give the fix. Examples: a provider is signed out, a network filter blocks OpenBot, the computer was asleep during a routine. Link the matching section of the troubleshooting guide, `github.com/nightly-labs/openbot/blob/main/docs/TROUBLESHOOTING.md` (an HTTPS link). Still offer the report.

## 4. Redact

Do this before you write the file. Replace each match with `[REDACTED:<kind>]`:

- Tokens and keys: `Bearer …`, `Authorization` headers, values after a label that contains `password`, `passphrase`, `secret`, `token`, `credential`, `cookie`, `api_key`/`apikey`, or `private_key`; `Cookie` and `Set-Cookie` headers.
- Known prefixes: `sk-`, `sk-ant`, `sk_`, `xai-`, `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`, `AKIA`, `ASIA`, `xox?-`, `xapp-`, `glpat-`, `rk_live_`, `whsec_`, `AIza`, `npm_`, `hf_`, `gsk_`.
- JSON web tokens (`eyJ….eyJ….…`), PEM private keys, and URL query values of `key`, `code`, `ticket`, `sig` and `token`.
- Email addresses, phone numbers, IP addresses, and names of people.
- The home folder: write `~` in place of `/Users/<name>`, `/home/<name>` or `C:\Users\<name>`.
- Names of private projects, files, and companies. Keep the names of OpenBot files and folders.
- Chat text, prompts, and routine instructions. Describe them in one neutral line instead.

Keep error codes, error names, status values, times, versions, and OpenBot paths: the team needs them.

After you write the file, search it again for these patterns, for example with `grep -nE`. Fix each match, and search again until nothing matches.

## 5. Write the report

Write `reports/<YYYY-MM-DD>-<short-slug>.md` in your working directory. Use this order, which follows the GitHub bug form:

```markdown
# <One-line title>

## Summary
<Two or three sentences.>

## Environment
- Platform:
- Installation source:
- OpenBot version:
- Operating system and hardware:
- Provider and CLI version:

## Area, severity, frequency

## What happened

## Steps to reproduce
1.

## Expected result

## Actual result

## Likely cause
<Each cause with: confirmed, likely, or not checked.>

## Evidence
<Short redacted log lines and database rows, each with its UTC time and source file.>

## Other problems found
<One line each, with its UTC time, or "none".>

## Not checked
<What you could not read, and why.>

## Redaction
Secrets, personal data, private names and chat text were removed. Read this file before you share it.
```

Attach it with `attach_files_to_response`.

## 6. Share

Tell the user, in a few lines: what went wrong, where the file is, and that they must read it before they share it.

Then ask with `ask_user`: "Open a prefilled bug report on GitHub?" Only on yes:

1. Build this HTTPS link. URL-encode each value and use short text only. Keep the whole link shorter than 6000 characters. Leave out a field that you do not know.

   ```text
   github.com/nightly-labs/openbot/issues/new?template=bug_report.yml&title=<title>&version=<version>&os=<os>&provider-version=<cli version>&description=<summary>&reproduction=<steps>&expected=<expected>&actual=<actual>
   ```

2. Open it in the default browser: `open "<link>"` on macOS, `xdg-open "<link>"` on Linux, `start "" "<link>"` on Windows. Also show it as a link in your answer, in case the browser did not open.
3. Tell the user: the issue is public. Sign in to GitHub, drag the report file into the form, select the dropdown values, read everything once more, tick the checklist, and press **Submit new issue**.

Never submit the form or create the issue yourself.
