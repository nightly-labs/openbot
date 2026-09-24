---
name: openbot-export
description: Export the user's Grok Bot agents into one .zip file that OpenBot imports, with instructions, avatars, skills, routines, memories, group chats, and optional workspace files. Use when the user asks to export, move, or migrate their agents to OpenBot.
example-prompt: Export my agents for OpenBot
---

# Export agents for OpenBot

Make one `.zip` file that the user opens in OpenBot at **Server settings → Import**. OpenBot reads
it on the user's computer. Nothing is uploaded. The format is strict: OpenBot rejects the whole
file when the manifest is invalid, so follow the format below exactly.

## Workflow

1. **Find the agents.** List every agent the user has in Grok Bot. For each agent, collect:
   - name, one-line role (title), and full instructions or system prompt;
   - avatar image;
   - skills: each skill folder with its `SKILL.md` and the files it uses;
   - scheduled tasks: name, prompt, schedule, time zone, and whether it is on;
   - chats: read them only to write memories (step 3);
   - workspace files, only if the user agrees (step 2).

   Do not export the agent that runs this skill. It exists only to make the export, so leave it out
   of the agent list and out of `openbot-import.json`, even when the user asks for all agents. Also
   leave this skill (`openbot-export`) out of every agent's skills.

   Also list every group chat, where several agents talk together. OpenBot imports a group chat as a
   channel. For each group chat, collect:
   - name, one-line topic (title), and its shared instructions;
   - the agents in it, and the lead agent if it has one;
   - scheduled tasks of the group chat, as for agents;
   - its messages: read them only to write memories (step 3).

   If you cannot read a part, tell the user what you could not export. Do not guess its contents.

2. **Ask about files.** Show the list of agents, the group chats, and the total size of the
   workspace files. Ask: "Include workspace files? (yes / no)". Also ask whether to export all agents
   and group chats or only some. Wait for the answer before you continue. Export every group chat,
   including one with only one other agent. Leave one out only when none of its agents are exported.

3. **Write memories.** From each agent's chats, write at most 50 short facts that the agent must
   keep: user preferences, names, recurring tasks, decisions, and open work. One fact per memory,
   500 characters or fewer, written as a statement ("The user reports in EUR."). Do not copy
   whole messages. Do not include secrets. For each group chat, write at most 32 facts the same way.

4. **Remove secrets.** Do not export `.env` files, private keys, API keys, tokens, passwords, or
   cookies, in files or in instructions. Replace a secret in instructions with
   `<ask the user for …>`. OpenBot rejects the archive if it contains a file named `.env*` or
   `*private*key*`, a nested archive (`.zip`, `.tar`, `.gz`, `.7z`, `.rar`), or a `.git` or
   `node_modules` folder, so leave those out.

5. **Build the folder** (see Format) and write `openbot-import.json` last.

6. **Check it** with the checklist below. Then zip the folder contents into
   `~/Downloads/.openbot-export-<YYYY-MM-DD>.zip.part`. When the zip is complete, rename it to
   `~/Downloads/openbot-export-<YYYY-MM-DD>.zip`. The rename replaces an older export with the
   same name in one step, so OpenBot never reads a half-written file.

7. **Tell the user**, only after the rename, the path, the number of agents and group chats, and
   anything you left out. Tell them to open OpenBot, go to **Server settings → Import**, and choose
   the file.

## Format

```
openbot-import.json
agents/<key>/avatar.png                 optional; PNG, JPEG, or WebP, 512 KB or less
agents/<key>/skills/<skill>/SKILL.md    one folder for each skill
agents/<key>/files/…                    optional workspace files
```

`<key>` is a short unique ID for the agent: lowercase letters, digits, and hyphens, such as
`research` or `sales-outbound`. It has 64 characters or fewer, and it does not start or end with a
hyphen. When you make a key from a long agent name, keep only the first words. All paths for an
agent must start with `agents/<key>/`.

`openbot-import.json`:

```json
{
  "format": "openbot-agent-import",
  "version": 1,
  "source": { "app": "grok-bot", "exportedAt": "2026-09-23T10:00:00Z" },
  "agents": [
    {
      "key": "research",
      "name": "Research",
      "title": "Market research analyst",
      "description": "You find sources, compare competitors, and write short cited briefs…",
      "avatar": "agents/research/avatar.png",
      "skills": ["agents/research/skills/web-brief"],
      "routines": [
        {
          "name": "Morning digest",
          "instruction": "Summarize yesterday's news about our competitors.",
          "active": true,
          "timezone": "Europe/Warsaw",
          "schedule": { "kind": "weekdays", "time": "08:30" }
        }
      ],
      "memories": ["The user reports in EUR.", "Competitors to watch: Acme, Globex."],
      "files": "agents/research/files"
    }
  ],
  "channels": [
    {
      "key": "market-desk",
      "name": "Market desk",
      "title": "Weekly competitor review",
      "instructions": "Research finds the news, Sales says what it means for open deals.",
      "members": ["research", "sales-outbound"],
      "lead": "research",
      "routines": [
        {
          "name": "Friday review",
          "instruction": "Review this week's competitor news and agree on three actions.",
          "active": true,
          "timezone": "Europe/Warsaw",
          "schedule": { "kind": "weekly", "weekday": 5, "time": "15:00" }
        }
      ],
      "memories": ["The user wants actions, not summaries."]
    }
  ]
}
```

`channels` is optional. Leave it out, or use `[]`, when there are no group chats.

Field rules:

| Field | Rule |
| --- | --- |
| `name` | Required. 80 characters or fewer. |
| `title` | Optional. 120 characters or fewer. |
| `description` | Required. The agent's instructions, 2,000 characters or fewer. If they are longer, write the full text to `agents/<key>/files/INSTRUCTIONS.md`, set `files`, and put a summary here that tells the agent to read `imported/INSTRUCTIONS.md`. |
| `avatar` | Path or `null`. |
| `skills` | Up to 32 folder paths. Each folder has `SKILL.md` at its root, which starts with YAML frontmatter that has `name` (80 characters or fewer) and `description`. Each skill folder is 10 MB and 200 files or fewer. |
| `routines` | Up to 64. `name` is 80 characters or fewer. `instruction` is the prompt that runs. `timezone` is an IANA name, such as `America/New_York`. |
| `memories` | Up to 64 strings, 500 characters or fewer each. |
| `files` | Folder path or `null`. OpenBot copies it to `imported/` in the agent's workspace. |

Channel field rules:

| Field | Rule |
| --- | --- |
| `key` | Required. The same rules as an agent key, and unique among the channels. |
| `name` | Required. 80 characters or fewer. |
| `title` | Optional. 120 characters or fewer. |
| `instructions` | Optional. The group chat's shared instructions, 2,000 characters or fewer. |
| `members` | Required. The `key` of each agent in the group chat. Use only agents in this export, at least one. Count every agent in the group chat, including the agent it is named after. Never the agent that runs this skill. |
| `lead` | Optional. The `key` of one member, or `null`. |
| `routines` | Up to 64, in the same shape as agent routines. |
| `memories` | Up to 32 strings, 500 characters or fewer each. |

A channel has no folder in the archive. Up to 100 channels.

The whole archive must be 500 MB and 5,000 files or fewer.

### Schedules

Use one of these shapes. Times are 24-hour `HH:MM` in the routine's time zone. Days of the week are
0 (Sunday) to 6 (Saturday). A schedule cannot run more often than every 3 minutes.

| Schedule | JSON |
| --- | --- |
| Every hour at minute 15 | `{ "kind": "hourly", "minute": 15 }` |
| Every day | `{ "kind": "daily", "time": "09:00" }` |
| Monday to Friday | `{ "kind": "weekdays", "time": "09:00" }` |
| Every week | `{ "kind": "weekly", "weekday": 1, "time": "09:00" }` |
| Every month | `{ "kind": "monthly", "day": 1, "time": "09:00" }` |
| Every N minutes, hours, or days | `{ "kind": "interval", "amount": 30, "unit": "minutes" }` |
| Cron expression | `{ "kind": "custom", "expression": "0 9 * * 1-5" }` |

When a schedule does not fit a shape, use `custom` with a cron expression. OpenBot skips a routine
with an invalid schedule and tells the user; the rest of the agent still imports.

## Checklist

- [ ] `openbot-import.json` is at the root of the zip, not inside a subfolder you added by mistake.
- [ ] `format` is `openbot-agent-import` and `version` is `1`.
- [ ] Each `key` is unique and 64 characters or fewer, and each path starts with `agents/<key>/`.
- [ ] Each skill folder has `SKILL.md` with frontmatter.
- [ ] The agent that runs this skill is not in `openbot-import.json`.
- [ ] No agent has an `openbot-export` skill folder.
- [ ] Every group chat is in `channels`, unless none of its agents are exported.
- [ ] Each channel has at least one `members` entry, each member is an agent `key` in this export, and
      `lead` is one of the members or `null`.
- [ ] No secrets, `.env` files, keys, nested archives, `.git`, or `node_modules`.
- [ ] Workspace files are included only if the user said yes.
