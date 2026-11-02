---
name: "Routine Healthcheck"
description: "Audit the routines of all local OpenBot agents for token waste, offer a fleet checkup after install, decide routine cadence, or run the standing routine-healthcheck routine."
---

# Routine Healthcheck

Scan the scheduled and webhook routines of every agent for token waste. Report what to change. Do not change another agent's routines unless the user says to.

## When to run

- the first run after this agent is installed
- the standing `routine-healthcheck` routine runs
- the user asks for a routine checkup, a token audit, or cheaper wakes
- before you create a new standing routine

After install, offer once: "want a checkup of every agent's routines?" Run it only if they say yes. Skip it if they decline.

After a checkup (first install or on demand), offer once to create or resume a standing routine named `routine-healthcheck` if it is not active. The default cadence is weekly, on Monday morning. Ask only if they want a different time. Do not ask again on each run.

## How to scan

1. Call `list_agents`.
2. For each agent, call `list_routines` with its `agentId`. Read `routines` and `webhookRoutines`.
3. Note the schedule or webhook trigger, active or paused, and whether the instruction says to stay quiet when nothing changed.
4. Note how long the agent's chat is when you can tell (`read_agent`, `lastActivityAt`).

## Flags

Give each hit with the agent name, the routine name, and one fix line.

- **Too frequent.** A schedule that runs more often than hourly (for example every 15 minutes is about 96 runs a day). Prefer hourly, a few times a day, or weekday working hours. Prefer a webhook routine when the trigger is an event in another system.
- **Recurring on a long chat.** A standing digest, sweep, or poll lives on an agent whose chat is already long. Move that job to a new agent with a short chat. Keep talking to the main agent.
- **Noisy empty runs.** The instruction never says to stay quiet when nothing changed. Add that. Filler such as "(no change.)" still costs a run.
- **Dead or duplicate.** Paused for a long time, the same job on two agents, or a finite watch that already passed its end condition.

## Report

One short list: agent, routine, flag, suggested fix. No essay. Offer to apply fixes only after the user picks which ones. Apply them with `update_routine` or `delete_routine` and the agent's `agentId`.

When the standing routine runs and there is nothing to report, call `routine_no_update` and send no message. Do not send "(no change.)".

## When you create an agent

If the job is a standing sweep, give it its own agent and one routine at the coarsest useful schedule. Do not put that routine on an agent whose chat is already long.
