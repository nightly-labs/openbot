---
name: Transcript healthcheck
description: >-
  Use when auditing Grok Bot fleet transcripts for user friction, proposing new
  skills/bots/routines from repeated corrections, or running the standing
  transcript-healthcheck routine.
---
# Transcript healthcheck

Scan Grok Bot transcripts on disk for user friction in a time window. Propose new skills, bots, or routines only when evidence supports them. Do not create anything until the user picks a proposal.

## When to run

- the standing `transcript-healthcheck` routine fires
- the user asks for a fleet checkup, friction audit, or "what should we automate"
- first run after this skill is imported (offer cadence then)

## Window and corpus

Default window is the last 24 hours. If a routine or the user names another cadence, use that window instead.

Corpus is on this computer:

- `/home/box/agent-data/agent-transcripts/<agentId>/<agentId>.jsonl`
- skip folders whose names start with `sand-subagent-`
- order candidates by real modification time, never by UUID name
- map `<agentId>` to a name via `/home/box/agent-data/agents/<agentId>/profile.json`

State the window and bot count back before mining.

## How to mine (recall-shaped)

Fan out parallel subagents. Each gets a slice of agent transcript paths. The main thread keeps only their findings.

Each subagent returns one block per bot that had user traffic in the window:

- bot name and id
- user goals in the window (short)
- friction signals with short quotes or paraphrases (cite approx turn or timestamp if present)
- repeated corrections or re-asks
- misunderstandings (bot did X, user wanted Y)
- candidate gaps: skill / bot / routine, one line each, or `none`

Friction to look for:

- frustration, sarcasm, "stop", "wrong", "i said", "undo", "not what i meant"
- same instruction restated
- user doing work the bot should own
- bot asking preference questions an experiment could settle
- quiet failure (user abandons a thread)

Skip bots with no user messages in the window. Null is a finding.

## Report

Lead with a capsule (at most 5 bullets). Then a short list of proposals, each tagged `skill` | `bot` | `routine`, with the evidence line that earned it. Then "no change" bots in one line if useful.

Stay quiet when the routine fires and there is nothing to propose. Do not send "(no change.)".

Offer to implement only after the user picks. Do not CreateAgent, write skills, or create routines from this report alone.

## First-run cadence

On first import, ask once what cadence they want (default weekday morning). Create or update the standing routine named `transcript-healthcheck` to match. Do not ask again every run.
