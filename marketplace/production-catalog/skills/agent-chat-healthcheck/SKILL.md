---
name: "Agent Chat Healthcheck"
description: "Audit the recent chats of local OpenBot agents for user friction, propose new skills, agents or routines from repeated corrections, or run the standing transcript-healthcheck routine."
---

# Agent Chat Healthcheck

Find user friction in the chats of local agents in a time window. Propose new skills, agents, or routines only when evidence supports them. Do not create anything until the user picks a proposal.

## When to run

- the standing `transcript-healthcheck` routine runs
- the user asks for a fleet checkup, a friction audit, or "what should we automate"
- the first run after this agent is installed (offer a cadence then)

## Window and agents

The default window is since the last successful run, or the last 24 hours if that is unknown. If a routine or the user names another window, use it.

1. Call `list_agents`.
2. Keep the agents whose `lastActivityAt` is inside the window. Skip the others. No activity is a finding.
3. `lastActivityAt` also counts the messages of the last healthcheck and the replies to it. Use `search_memories` to find the memory "agent chat healthcheck: last reply at <time>". Skip an agent whose `lastActivityAt` is not later than that time.
4. Include your own chat.

State the window and the number of agents back before you start.

## How to collect

You cannot read another agent's chat. Ask each active agent with one `send_message` (all of them in one call, `recipientAgentIds`). The message must stand on its own:

```
Goal: Report user friction in your own chat for <window>.
Limits: Read only. Do not change anything. Do not message the user.
Done looks like: one block with
- user goals in the window (short)
- friction signals with short quotes or paraphrases and an approximate time
- repeated corrections or re-asks
- misunderstandings (you did X, the user wanted Y)
- candidate gaps: skill | agent | routine, one line each, or "none"
Reply "none" when there was no user message in the window.
```

Friction to look for:

- frustration, sarcasm, "stop", "wrong", "i said", "undo", "not what i meant"
- the same instruction restated
- the user doing work that the agent should own
- the agent asking preference questions that an experiment could settle
- quiet failure (the user leaves a thread)

Do not wait in a loop. Use the replies that arrive. Say which agents did not reply. After the last reply, save the time with `remember` as "agent chat healthcheck: last reply at <time>", and replace the earlier memory with `forget_memory`.

## Report

Start with a capsule of at most 5 bullets. Then a short list of proposals, each tagged `skill` | `agent` | `routine`, with the evidence line that earned it. Then the "no change" agents in one line if useful.

When the routine runs and there is nothing to propose, call `routine_no_update` and send no message. Do not send "(no change.)".

Offer to implement only after the user picks. Do not call `create_agent`, write skills, or create routines from this report alone.

## First-run cadence

After install, ask once what cadence they want (default: weekday mornings). Create, update, or resume the standing routine named `transcript-healthcheck` to match. Do not ask again on each run.
