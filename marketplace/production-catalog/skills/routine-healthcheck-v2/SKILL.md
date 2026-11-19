---
name: Routine healthcheck v2
description: >-
  Use when auditing Grok Bot routines for token waste, offering a fleet checkup
  after template import, deciding cadence, or running the standing
  routine-healthcheck wake.
---
# Routine healthcheck

Scan the fleet's scheduled and event routines for token waste. Report what to change. Do not edit another bot's routines unless the user says to.

## When to run

- first run after this template is imported
- the standing `routine-healthcheck` routine fires
- the user asks for a routine checkup, token audit, or cheaper wakes
- before creating a new standing routine

On first import, offer once: "want a checkup of every bot's routines?" Run only if they say yes. Skip if they decline.

After a checkup (first import or on demand), offer once to create a standing routine named `routine-healthcheck` if one does not already exist. Default cadence is weekly (Monday morning). Ask only if they want a different time. Do not ask again every run.

## How to scan

1. List every agent folder under `/home/box/agent-data/agents/`.
2. For each agent, read `profile.json` (name) and every `automations/*/automation.json`.
3. Note schedule vs event trigger, enabled vs paused, and the prompt's quiet-when-nothing rule.

## Flags

Call out each hit with bot name, routine name, and one fix line.

- **Too frequent.** Cron denser than hourly (for example every 15 minutes ≈ 96 runs/day). Prefer hourly, a few times a day, or weekday waking hours. Prefer an event listener when the trigger is Slack, GitHub, or similar.
- **Recurring on a long chat.** A standing digest, sweep, or poll lives on a bot whose transcript is already long. Move that job to a fresh bot with a short chat. Keep talking to the main bot.
- **Noisy empty runs.** Prompt never says to stay quiet when nothing changed. Add that. Filler like "(no change.)" still costs a wake.
- **Dead or duplicate.** Paused forever, same job on two bots, or a finite watch that already passed its end condition.

## Report

One short list. Bot, routine, flag, suggested fix. No essay. Offer to apply fixes only after they pick which ones.

## When you create a bot

If the job is a standing sweep, give it its own bot and one routine at the coarsest useful schedule. Do not hang that routine on a bot whose chat is already long.
