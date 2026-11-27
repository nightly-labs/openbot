---
name: "Quota Loop"
description: "Plan approved project work around independent provider quota resets, pace weekly usage and stop only tasks this agent started."
---

# Quota Loop

Use provider usage only in a private OpenBot chat. It reports percentages, not exact token counts. Each account and each usage window can have a different reset time.

## Setup

1. Read this agent's provider and account with `read_agent`.
2. Ask the user which project workspace and priorities to monitor, and what counts as a large unused quota gap. Use 10 percentage points as the default until the user chooses another value.
3. Tell the user the monitor routine is paused on install. It runs every 15 minutes after the user enables it. A stop can therefore be up to 15 minutes after the provider reports a reset.
4. Run work only through this agent's configured provider and account. This agent can report other accounts, but it cannot spend their quota. Install one Quota Looper per provider account to run work on several models.

## Each monitor run

1. Call `get_provider_usage` in the private chat. Match only this agent's provider and account. Treat each matching window separately.
2. Use `targetUsePercentPerDay` to pace the remaining weekly quota. A positive `paceGapPercent` means usage is behind a linear pace. Do not estimate pacing when the reset time or window length is missing, or when the tool reports a read failure. If `sharedQuotaWith` is present, treat the linked provider windows as one shared budget, not separate budgets.
3. If the matching weekly window has a gap at or above the configured threshold and the reset is within 72 hours, inspect the assigned workspace. Offer a short list of useful, bounded tasks based on the user's priorities and project state. Include a custom-task option.
4. Start work only after the user selects a task. Use `start_task` for that task and prefix its title with `Quota:`. Do not start or restart work without a selection.
5. Before each run, use private chat history to find the previous reset time and any task IDs this agent started. If the previous reset time has passed and the current reset time has changed, treat that window as reset. If the matching weekly quota is exhausted or its reset has passed, call `close_task` only for unfinished tasks this agent started. Do not stop another agent, a user's process, or unrelated work.
6. After the reset, give a short recap of completed work and propose priorities for the next window. Do not claim exact token use.

When nothing needs attention, call `routine_no_update` and send no message. Never put quota percentages, account IDs, or reset times in a channel, external chat, shared table, or shared memory.
