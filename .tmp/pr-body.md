### Linked issue

Related: #7679 — its triage traced the residual notifications to surfaces that skip the per-agent
check. This fixes one of those surfaces: the per-member mute in the Live Activity. It does not close
that issue (channel replies and usage-limit notices remain). Sent as a bug fix, so it needs no
approved issue.

### Type of change

- [x] Bug fix

### What changed

The iOS Live Activity and Dynamic Island now follow each member's per-agent mute. Before, an agent
muted to `nothing` (sidebar "Mute agent", the per-member level of `agent-notification-levels-v1`)
still appeared in the island: host pushes named it while the phone was away, and the phone's own
island updates listed it while the app ran. The mute promise — no notifications from this agent for
me — now holds for the island content, the unread list, and `showsEvent`. Unmuting restores the agent
at once on the phone, and at the next agent event through host push. Each member's mutes stay their
own; the host owner's mutes apply to his own pushes through the owner key.

Smallest useful change: the Dynamic Island coordinator gains one per-server, per-member muted agent
set; the host Live Activity push computes it with the same `agentNotificationLevel` math that desktop
and regular push already use; the phone applies its synced levels with one effect. No wire payload,
route, or capability change; nothing under `packages/contracts/` changes.

Surfaces touched: host push (`src/main`), the team-client coordinator, and the mobile Live Activity
hook. The desktop macOS island and the web client stay unchanged (they have no setter callers). This
works on a joined server as it does locally: the host filter resolves per registered member's own
levels, and the phone uses the member's synced copy — nothing is local only.

### Verification

- [x] Narrow checks: `bun run test:live-activity-agent-mute-host`, `bun run test:live-activity-agent-mute-phone`, `bun run test:desktop-notifications`, `bun run test:push-notification-away`, `bun scripts/live-activity-ice-away-e2e.ts`, `bun scripts/live-activity-inline-fence-e2e.ts`, `bun run typecheck:node`, and the `packages/team-client` typecheck — all pass
- [x] Surfaces named under "What changed"
- [x] Joined-server behavior covered: both new e2e scripts test per-member isolation (a second member without the mute still gets the agent)
- [x] Manual smoke: the two new e2e scripts write repeatable reports under `.openbot-build/live-activity-agent-mute-{host,phone}-e2e/report.json`; mute, unmute, cross-member, and cross-server isolation are asserted
- [x] No credentials, private data, generated output, or real user files are included

### Reviewer note

This PR comes from a fork, so the automated reviewer cannot publish a review on its own. A
maintainer can add the `norbiai` label or comment `/norbiai review` to run it.
