# Host state Durable Object

Status: slice 1 is in the code behind `HOST_STATE_MODE`, and the mode is `off`. Production has no
`HOST_STATE` binding yet. Decided by the developer on 2026-11-28: a Durable Object for each host, for
a target of 100 times the current users.

## Goal

The account Worker has one D1 primary. Each host request reads D1. This document moves the host hot
path to one SQLite-backed Durable Object for each host (`HostState`, keyed by `idFromName(hostId)`).
D1 stays the source of truth during the move.

## Measured load (2026-11-27, one day, primary and replica)

| Statement group | Queries a day | Share |
| --- | ---: | ---: |
| All statements | 26.9M | 100% |
| Statements keyed by host | about 5M | about 19% |
| Host credential read (`#host`, `SELECT … FROM remote_hosts WHERE host_id = ?`) | 1.82M | 6.8% |
| Sign-in session read (`auth_sessions` JOIN `users`) | 7.9M | 29.4% |
| Remote session read (`remote_sessions` JOIN memberships and hosts) | 2.1M | 7.8% |
| `remote_hosts` writes (`signal_home`, metadata, registration) | about 0.21M | 0.8% |

Normal load: about 9,000 primary and 6,500 replica queries a minute. A Signal restart went to
24,500 primary queries a minute. D1 refused queries (error 7429) at about 23,000 primary queries a
minute.

## What moves and what stays

| Data | Slice | Owner after the slice | Kind |
| --- | --- | --- | --- |
| Host credential: `machine_token_hash`, `auth_epoch`, `owner_user_id`, `device_public_key`, `signal_home`, `name`, `logo_key` | 1 | D1; the object keeps a checked copy | Read through, invalidated on write |
| Host ticket and route credential checks (`authenticateHost`, `assertHostCredential`) | 1 | Read through the object | No storage of their own |
| Active memberships and roles of one host | 2 | D1; the object keeps a checked copy | Read through, invalidated on write |
| Remote sessions of one host (`remote_sessions`) | 3 | Object | Short-lived rows that the object owns, copied to D1 |
| Auth events to Signal (`remote_auth_events` outbox) | 3 | Object | Short-lived rows that the object owns |
| Users, sign-in sessions, licenses, billing, hosted servers, invitations, transfers | — | D1 | Not keyed by host |

Sign-in sessions stay in D1. The plan for them is signed access tokens in the next release.

## Write-through and owned rows

- Slice 1 and 2 data stays in D1. Each change path writes D1 first, then calls `invalidate()` on the
  object. Invalidation adds 1 to a stored generation and clears the copy.
- A read that finds no copy, an old copy (60 s or more), or a token that does not agree reads the D1
  primary. Then it calls `fill(copy, checkedAt, generation)`. The object refuses the fill when the
  generation changed after the read. So a slow reader cannot put back an old copy.
- The checked copy stays in memory only. SQLite keeps only the generation. A fill writes no row, so
  the object writes 1 row for each change and none for each read.
- A new object makes its table only on its first invalidation. A request with an unknown host ID
  writes no storage.
- Slice 3 rows (sessions, events) have a life of minutes to days. The object owns them and writes a
  copy to D1 in the background, so a return to D1 loses no data.

Change paths that invalidate in slice 1 (all `remote_hosts` writes in `remote-control-plane.ts`):
`registerHost` (metadata and rotation), `revokeHostCredential`, `handOverHostKey`, `setHostLogo`,
`changeMembership` (access removal), `acceptOwnerTransfer`, `deleteHost`, `issueHostTicket`
(`signal_home = NULL`), and `#storeSignalHome`. Other files only read `remote_hosts`.

## Consistency

| Change | Seen by the next host request | Worst case |
| --- | --- | --- |
| Key rotation, credential revoke, key handover | At once (invalidation) | 60 s, when the invalidation call fails |
| Epoch bump (member removed, owner transfer) | At once | 60 s |
| Host removed | At once | 60 s |
| Signal home change | At once | 60 s |

The 60 s worst case is the developer decision of 2026-11-28. A Worker isolate cache cannot do
this, because each location has its own copy. The object is one place for each host, so one
invalidation reaches all locations.

## Failure and retry

| Event | Result |
| --- | --- |
| Object call fails or takes more than 1 s | The Worker logs `Host state call failed: <op>` and reads D1, as today |
| Invalidation fails after the D1 write | The change is saved. The old copy is used for up to 60 s |
| Cloudflare moves or restarts the object | The memory copy is lost. The next read goes to D1. The generation stays in SQLite |
| Object unavailable for a long time | Each host request waits up to 1 s, then reads D1. D1 load goes back to today's load |
| D1 unavailable | Host requests with a fresh copy (less than 60 s) still work. Others fail as today |

There is no extra retry layer. The fill is not retried. The invalidation is not retried in slice 1.

## Migration

1. **Copy on read.** Mode `read` fills the object from the D1 primary on a miss. `checkedAt` is the
   check field: a copy older than 60 s is read from D1 again.
2. **Dual reads.** Slice 1 needs no separate mode for this: each copy is compared with D1 at least
   once a minute. Slice 3, where the object owns rows, gets a `verify` mode first. It reads both,
   serves D1 and counts each difference.
3. **Switch.** Slice 3 makes the object the owner of its rows, and D1 gets a copy in the background.
4. **Go back.** Set `HOST_STATE_MODE` to `off`. The Worker reads only D1. Slice 1 and 2 keep nothing
   in the object that is not in D1, so no data is lost. Slice 3 copies its rows to D1 before the
   switch back.

No D1 migration is needed. The object has its own SQLite schema (`host_state`, one row).

## Wire compatibility

No route, request, response or ticket changes. Hosts and clients of the last 60 days see the same
protocol. Any later route for the object is optional and gated by a host capability.

## Cost model

List prices (not confirmed on the Cloudflare pricing page in this change, see Unconfirmed claims):

| Item | Durable Objects | D1 |
| --- | --- | --- |
| Requests | $0.15 per million, 1M included | No charge for each query |
| Duration | $12.50 per million GB-s, 400,000 GB-s included | — |
| Rows read | $0.001 per million | $0.001 per million |
| Rows written | $1.00 per million | $1.00 per million |
| Storage | $0.20 per GB-month | $0.75 per GB-month |

Model for slice 1: each host authentication is 1 object read, and each miss adds 1 fill. Each
`remote_hosts` write is 1 invalidation and 1 row written. Duration is 5 ms at 128 MB for each call.
Rows written use the list price with no included amount.

| Load | Host auth a month | Object requests a month (0% to 90% hits) | Rows written a month | Cost a month |
| --- | ---: | ---: | ---: | ---: |
| 1x | 55M | 66M to 115M | 6.3M | $16 to $24 |
| 10x | 550M | 660M to 1.15B | 63M | $160 to $240 |
| 100x | 5.5B | 6.6B to 11.5B | 630M | $1,670 to $2,450 |

The D1 reads that the object replaces cost almost nothing. The object costs money only for
throughput. The first design wrote 1 SQLite row on each fill. With the hit rate below, that is up
to 55M rows ($55) a month at 1x and $5,500 a month at 100x. Slice 1 keeps the copy in memory to
prevent this cost.

## D1 primary queries after slice 1

| Case | Primary queries a minute (normal) |
| --- | ---: |
| Today | about 9,000 |
| Slice 1, all host credential reads served (upper limit) | about 7,700 (at most −1,264) |
| Slice 1 with the 60 s recheck and one ticket each 150 to 180 s | about 8,700 to 9,000 (see below) |

Local E2E counts (`bun run test:host-state-object`, real workerd, real D1, real object):

| Sequence | `origin/main` | Mode `off` | Mode `write` | Mode `read` | Mode `read`, object fails |
| --- | ---: | ---: | ---: | ---: | ---: |
| 3 tickets, 2 Signal home lists, 2 wrong tokens | 8 | 8 | 8 | 3 | 8 |
| 20 tickets and home lists on one host | 20 | — | — | 1 | — |

## Problems with the plan (numbers)

1. **Slice 1 does not reach 100x.** It can remove at most 1.82M of 26.9M queries a day (6.8%). All
   host-keyed statements are 19%. With all of them on objects, the other 81% is still about 1.26M
   queries a minute on one D1 at 100x.
   D1 refused queries at about 23,000 primary queries a minute. The sign-in session read (29.4%) and
   the remote session read (7.8%) must also leave D1: signed access tokens, then slice 3.
2. **The 60 s recheck is shorter than the ticket gap.** A ticket lives 180 s
   (`TICKET_TTL_SECONDS`), so a host asks for a new one about each 150 to 180 s (estimate from the
   ticket life; the gap for each host is not measured). The copy is then older than 60 s at most ticket
   requests, so most tickets still read D1. Slice 1 helps when one host makes many requests in one
   minute: a Signal restart (24,500 a minute), and route and home calls after a ticket. The steady
   state saving is not known without the gap between requests of each host.
   Fix (next step): retry a failed invalidation from the existing `remote_auth_events` outbox, so the
   60 s limit no longer depends on the recheck. Then the recheck can be 10 min. The copy must then
   be stored in SQLite, because an idle object leaves memory. The cost is 1 row for each host each
   10 min.
3. **Rollback barrier.** After production gets the `new_sqlite_classes` migration, a rollback to a
   Worker version before it may be refused (not confirmed). The Worker 500 rollback recipe then
   cannot go back past that deploy. So the binding and the migration tag ship alone, with mode `off`.
4. **Latency.** Each host authentication adds 1 object call. A miss adds 2 calls and a D1 read. A
   failing object adds up to 1 s to each host request until it recovers.
5. **One flag for all hosts.** `HOST_STATE_MODE` has no percentage. The D1 fallback and the 60 s
   recheck make a global switch safe enough for slice 1. Slice 3 needs a percentage by host ID.

## Rollout and approvals

| Step | Change | Approval |
| --- | --- | --- |
| 1 | This change: class, client, invalidation, E2E. Mode `off`. Binding and migration only in `env.test` | PR review and merge. The merge deploys the Worker with no production change |
| 2 | Add the `HOST_STATE` binding and migration tag `host-state-v1` (`new_sqlite_classes`) to production and preview, mode `off` | Developer approval for the migration tag (rollback barrier). Deploy on merge |
| 3 | `HOST_STATE_MODE` = `write` in production | PR and deploy. Watch the `Host state call failed` log count and the object request count for 1 day |
| 4 | `HOST_STATE_MODE` = `read` in production | PR and deploy. Watch D1 primary queries a minute and 7429 errors at the next Signal restart |
| 5 | Durable invalidation through the outbox, recheck 10 min | New PR |
| 6 | Slice 2 (memberships), then slice 3 (remote sessions, events) with `verify` mode | New PRs, each with its own approval |

Go back at any step: set `HOST_STATE_MODE` to `off` and deploy. To remove the class, a
`deleted_classes` migration deletes the object storage (only generations in slice 1).

## Unconfirmed claims

| Claim | Where I looked |
| --- | --- |
| Durable Object and D1 list prices and included amounts | Prices from the measurement notes of 2026-11-27; the Cloudflare pricing page was not read in this change |
| 5 ms of billed duration for each object call | Not measured; local workerd does not report billed duration |
| A host asks for a ticket each 150 to 180 s | Estimate from `TICKET_TTL_SECONDS`; no host count and no gap for each host in the measurement data |
| Rollback across a Durable Object migration is refused | Not tested; no Cloudflare API call was made |
| An idle object leaves memory after about 70 to 140 s | Not measured |
