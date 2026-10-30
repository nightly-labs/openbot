---
name: openbot-export
description: Export the user's Hermes Agent profiles into one .zip file that OpenBot imports, with each profile's persona, memories, skills, and cron jobs. Use when the user asks to export, move, or migrate their Hermes agents to OpenBot.
example-prompt: Export my agents for OpenBot
---

# Export Hermes profiles for OpenBot

Make one `.zip` file that the user opens in OpenBot at **Server settings → Import → Hermes Agent**.
OpenBot reads it on the user's computer. Nothing is uploaded. Each Hermes profile becomes one OpenBot
agent. The format is strict: OpenBot rejects the whole file when the manifest is invalid, so follow
the format below exactly.

## Workflow

1. **Find the profiles.** The Hermes folder is `$HERMES_HOME`, or `~/.hermes` when it is not set.
   When `$HERMES_HOME` ends in `/profiles/<name>`, the Hermes folder is two levels up.
   - The `default` profile is the Hermes folder itself.
   - Each named profile is a folder in `<Hermes folder>/profiles/`. Skip `profiles/.deleted`.
   - A folder is a profile when it has `SOUL.md` or `config.yaml`.

   `hermes profile list` shows the same list.

2. **Read each profile.** Read only these files:
   - `SOUL.md`: the persona. Ignore HTML comments. When only a heading is left, the profile has no
     persona of its own.
   - `memories/MEMORY.md` and `memories/USER.md`: entries are separated by a line with only `§`.
   - `skills/`: each folder with a `SKILL.md`, at `skills/<name>/` or `skills/<category>/<name>/`.
     Skip folders whose name starts with `.`. Skip each skill whose frontmatter `name` is in
     `skills/.bundled_manifest` (one `name:hash` per line): those come with Hermes. Skip this skill
     (`openbot-export`).
   - `cron/jobs.json`: `{"jobs": [...]}`. Each job has `name`, `prompt`, `schedule`, `enabled` and
     `state`.

   Do not read `.env`, `auth.json`, `state.db`, `sessions/`, `mcp-tokens/` or `vault/`. They hold
   keys and chat history, which OpenBot does not import from a file.

3. **Ask which profiles.** Show the profiles with their number of memories, skills and cron jobs.
   Ask: "Export all profiles, or only some?" Wait for the answer before you continue.

4. **Map each profile** to one agent in `openbot-import.json` (see Format):
   - `key`: the profile name, with `_` changed to `-`. The `default` profile has the key `hermes`.
   - `name`: `Hermes` for the `default` profile. For a named profile, its name as words with the
     first letter in capitals: `research-desk` becomes `Research desk`.
   - `description`: the persona. When it is longer than 2,000 characters, write the full text to
     `agents/<key>/files/SOUL.md`, set `files`, and write a short summary here that ends with
     "Read imported/SOUL.md before your first task." With no persona, write one sentence about what
     the profile does from its memories and skills.
   - `memories`: each entry, 500 characters or fewer. Split a longer entry into short facts. At most 64.
   - `skills`: copy each skill folder to `agents/<key>/skills/<name>/`.
   - `routines`: one for each cron job (see Schedules). Set `active` to `false` when `enabled` is
     `false` or `state` is `paused`. Skip a job that has a `script` or has `no_agent` set: it runs a
     script, not the agent. Tell the user which jobs you skipped.

5. **Remove secrets.** Do not copy `.env` files, private keys, API keys, tokens, passwords or
   cookies, in files or in text. Replace a secret in a persona or a memory with
   `<ask the user for …>`. OpenBot rejects the archive if it contains a file named `.env*` or
   `*private*key*`, a nested archive (`.zip`, `.tar`, `.gz`, `.7z`, `.rar`), or a `.git` or
   `node_modules` folder. A skill that has one of these is left out: tell the user.

6. **Build the folder** in a new temporary folder outside the Hermes folder (see Format). Write
   `openbot-import.json` last.

7. **Check it** with the checklist below. Then zip the folder contents into
   `~/Downloads/.openbot-export-hermes-<YYYY-MM-DD>.zip.part`, with `openbot-import.json` at the
   root of the zip. Python works everywhere:
   `python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2])" <base> <folder>`
   writes `<base>.zip`, so rename it to the `.zip.part` name. When the zip is complete, rename it
   to `~/Downloads/openbot-export-hermes-<YYYY-MM-DD>.zip`. The rename replaces an older export with
   the same name in one step, so OpenBot never reads a half-written file. Then delete the
   temporary folder.

8. **Tell the user**, only after the rename: the path, the number of agents, and what you left
   out. MCP servers and keys stay in Hermes: to bring the MCP servers too, the user chooses
   **Read this computer** in OpenBot instead. Tell them to open OpenBot, go to
   **Server settings → Import → Hermes Agent**, and choose the file.

## Format

```
openbot-import.json
agents/<key>/skills/<skill>/SKILL.md    one folder for each skill
agents/<key>/files/SOUL.md              only for a persona longer than 2,000 characters
```

`<key>` is lowercase letters, digits and hyphens, 64 characters or fewer, and does not start or end
with a hyphen. Each key is unique. All paths for an agent start with `agents/<key>/`.

`openbot-import.json`:

```json
{
  "format": "openbot-agent-import",
  "version": 1,
  "source": { "app": "hermes-agent", "exportedAt": "2026-10-21T10:00:00Z" },
  "agents": [
    {
      "key": "hermes",
      "name": "Hermes",
      "title": "",
      "description": "You are Hermes, a calm personal assistant. Keep answers short…",
      "avatar": null,
      "skills": ["agents/hermes/skills/daily-brief"],
      "routines": [
        {
          "name": "Morning brief",
          "instruction": "Write my morning brief.",
          "active": true,
          "timezone": "Europe/Warsaw",
          "schedule": { "kind": "custom", "expression": "30 7 * * *" }
        }
      ],
      "memories": ["The user keeps notes in Obsidian.", "The daily brief goes out at 07:30."],
      "files": null
    }
  ]
}
```

Field rules:

| Field | Rule |
| --- | --- |
| `name` | Required. 80 characters or fewer. |
| `title` | Optional. 120 characters or fewer. |
| `description` | Required. 2,000 characters or fewer. |
| `avatar` | `null`. Hermes profiles have no avatar. |
| `skills` | Up to 32 folder paths. Each folder has `SKILL.md` at its root, which starts with YAML frontmatter that has `name` (80 characters or fewer) and `description`. Each skill folder is 10 MB and 200 files or fewer. |
| `routines` | Up to 64. `name` is 80 characters or fewer: the job's `name`, or the first words of its prompt. `instruction` is the job's `prompt`. `timezone` is the computer's IANA time zone, such as `Europe/Warsaw`. |
| `memories` | Up to 64 strings, 500 characters or fewer each. |
| `files` | `agents/<key>/files` or `null`. OpenBot copies it to `imported/` in the agent's workspace. |

The whole archive must be 500 MB and 5,000 files or fewer.

### Schedules

A Hermes job's `schedule` has a `kind`:

| Hermes schedule | OpenBot schedule |
| --- | --- |
| `{"kind": "cron", "expr": "0 9 * * 1-5"}` | `{ "kind": "custom", "expression": "0 9 * * 1-5" }` |
| `{"kind": "interval", "minutes": 30}` | `{ "kind": "interval", "amount": 30, "unit": "minutes" }`. Use `hours` or `days` when the minutes divide evenly. |
| `{"kind": "once", "run_at": "…"}` | Skip it, and tell the user. |

A schedule cannot run more often than every 3 minutes. OpenBot skips a routine with an invalid
schedule and tells the user; the rest of the agent still imports.

## Checklist

- [ ] `openbot-import.json` is at the root of the zip, not inside a subfolder.
- [ ] `format` is `openbot-agent-import`, `version` is `1`, and `source.app` is `hermes-agent`.
- [ ] Each `key` is unique and 64 characters or fewer, and each path starts with `agents/<key>/`.
- [ ] Each skill folder has `SKILL.md` with frontmatter, and no skill is `openbot-export`.
- [ ] No skill that comes with Hermes is in the export.
- [ ] No secrets, `.env` files, `auth.json`, keys, nested archives, `.git` or `node_modules`.
