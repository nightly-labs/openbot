---
name: Design a Grok Bot
description: >-
  Use this when designing or creating a new Grok Bot. Ask a few preference
  questions, write a tight persona, CreateAgent, then verify against the live
  profile. Coding bots use pstack / poteto-mode as the quality bar. On a fresh
  install, run setup-pstack first and ensure healthcheck routines exist.
---
# Design a Grok Bot

Create the bot. Do not ship a shareable template unless the user asked for a template.

## Data shape

A bot is four fields, in this order:

1. **One job.** One sentence. What it does every time it wakes.
2. **Anti-jobs.** What it never does, even if asked. Adjacent work goes to a different bot.
3. **Voice.** A few words. Match the user, or a named character. Not a generic assistant.
4. **Wake.** On-demand chat, a standing routine, or both. Quiet when there is nothing to report.

Name is short. Description carries all four. Do not pad with leftover tools, model essays, or "I can also help with..."

`CreateAgent` takes `name` and `description` only. That description is the whole persona. After create, prove it by reading `/home/box/agent-data/agents/<id>/profile.json`. Do not trust the tool ack alone.

There is no delete tool. Only create when the job is real.

## Fresh install (this bot, after template import)

On the first real user message after this template is imported, do this once before designing anything:

1. Run pstack's setup-pstack skill (`/setup-pstack`) when `~/.cursor/rules/pstack-models.mdc` is missing. Skip if the rule already exists. Do not ask permission. Then `/create-verification-skill` only when a real repo is present and no `verify-*` skill exists.
2. **Prove the standing healthcheck routines exist on this bot.** List `/home/box/agent-data/agents/<this-agent-id>/automations/`. If `transcript-healthcheck` is missing, create it with `update_state` (target `routine`, action `create`): name `transcript-healthcheck`, schedule `44 8 * * 1-5`, prompt pointing at Transcript healthcheck skill, quiet when nothing to propose. If `routine-healthcheck` is missing, create it the same way: name `routine-healthcheck`, schedule `49 8 * * 1`, prompt pointing at Routine healthcheck skill, quiet when nothing to propose. Tell the user what you created (or that both were already there). Do not wait for them to ask. Template import may not materialize packed routines — this step is the safety net.
3. Offer once: "want a checkup of every bot's routines?" Run Routine healthcheck only if they say yes.

Skip steps already done in this chat. Do not re-create routines that already exist.

## Intake

Ask only preference questions no experiment can settle. Typical set, skip any already answered:

- the one job
- voice and name, if they care
- standing routine vs on-demand
- who it talks to (this user, other bots, an outside channel)

Do not ask for tools, plugins, or model if you can copy a working sibling. Do not ask "should I create it?" after the job is clear. Create it.

If the ask is reversible detail (color, a nickname), pick it and say what you picked.

## Coding bots

Bar is pstack. Read pstack's poteto-mode (and boteto-mode on Grok Bot) when writing the persona. pstack is the coding-agent workflow pack: one job, unslopped prose, verified work, CloudAgent for repo work.

Bake into the description:

- one job and anti-jobs
- unslopped, short replies
- repo work goes to a CloudAgent, not a local clone
- slash-skills are live files, not app commands, if this user uses them
- copy the current model rule from an existing coding bot unless the user names one
- point at pstack / poteto-mode as situational, not standing

Do not paste the full pstack playbook into the description.

If pstack is not installed, say so and keep the same tightness anyway.

## Non-coding bots

Same tightness, different job. Scout, shopkeep, life-admin, dispatcher, writer.

Bake into the description:

- ONLY job, named in the first sentence
- stay quiet when there is nothing to report
- never do the adjacent verb (a mentions scout does not post, a drafter does not send)
- the concrete how (which API, which inbox, which channel), not "use whatever tools you have"

No coding instructions unless the job is hybrid and the split is explicit (coordinate vs write code).

## After create

Read the live profile back. Tell the user the name and the one-job line. Mention they delete from the sidebar (right-click, Delete) if they hate it.

If the job needs a standing routine, you cannot write another bot's routines from here. Immediately SendToAgent that new bot with an explicit instruction to call update_state (target routine, action create) with the concrete name, prompt, and schedule or trigger. Do not stop at "set it up in its chat." Confirm to the user that you messaged it to create the routine. If SendToAgent fails, say so and give them the one-line create instruction to paste into that bot.
