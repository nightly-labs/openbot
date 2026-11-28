# Host state Durable Object

Status: slices 1 to 3 are in the code behind `HOST_STATE_MODE`, and the mode is `off`. Production and
preview have the `HOST_STATE` binding and the migration tag `host-state-v1` since 2026-11-28 (step 2
of the production deploy, approved by the developer). Decided by the developer on 2026-11-28: a Durable Object for each host,
for a target of 100 times the current users. A revoked sign-in, a removed member or a rotated host
key may work for up to 60 s. The sign-in check of a remote session is a cache.

## Goal

The account Worker has one D1 primary. Each host request reads D1. This document moves the host hot
path to one SQLite-backed Durable Object for each host (`HostState`, keyed by `idFromName(hostId)`,
called through RPC). D1 stays the source of truth.

## Measured load (2026-11-27, one day, primary and replica)

| Statement group | Queries a day | Share |
| --- | ---: | ---: |
| All statements | 26.9M | 100% |
| Statements keyed by host | about 5M | about 19% |
| Host credential read (`#host`, `SELECT … FROM remote_hosts WHERE host_id = ?`) | 1.82M | 6.8% |
| Sign-in session read (`auth_sessions` JOIN `users`) | 7.9M | 29.4% |
| Remote session read for a session ticket | 2.1M | 7.8% |
| Host list read (`listHosts`, 3.37M rows read, 444k ms) | 1.04M | 3.9% |
| `remote_hosts` writes (`signal_home`, metadata, registration) | about 0.21M | 0.8% |

Route sample of the same day (Worker tail): session ticket 23.4% of requests, host list 11.4% (8.4% of
CPU), validate-batch 5.1%. Normal load: about 9,000 primary and 6,500 replica queries a minute. D1
refused queries (error 7429) at about 23,000 primary queries a minute.

## What the object keeps

The object has 2 tables: `host_state(generation)` and `host_copy(key, value, checked_at)`.

| Key | Slice | Value | Read by |
| --- | --- | --- | --- |
| `v1:credential` | 1 | Host row: token hash, `auth_epoch`, owner, device key, `signal_home`, name, logo | `authenticateHost`, `assertHostCredential`, host claims in validate-batch |
| `v1:session:<id>` | 2 | Session, membership and host columns, and `auth_live` (the sign-in session was live at `checked_at`) | `validateResumeClaims`, validate-batch, `sessionOpen` |
| `v1:listing` | 3 | Key handovers, owner licenses, custom member limit, plan entitlements (the 4 JSON parts of `listHosts`) | `GET /v2/remote/hosts/` |

The session ticket routes (`POST /v2/remote/sessions/<id>/ticket` and the browser ticket route) do not
read the object. They call `findSignedInSession`: one joined query on the replica that checks the
caller's sign-in and the remote session together. The object does not know the caller's sign-in, so
a copy saves no query on this route.

Users, sign-in sessions, licenses, billing, hosted servers, invitations and transfers stay in D1
only. The host list still reads name, role, `hidden_at` and the hosted server columns from D1 on
each call, in a light query with no JSON subqueries.

## Fill and invalidation

- Each change path writes D1 first, then calls `invalidate()`. Invalidation adds 1 to the generation
  and deletes all copies.
- A read that finds no copy, or a copy of 10 min or more, reads the D1 primary. Then it calls
  `fill(generation, now, entries)`. The object refuses the fill when the generation changed after the
  read, so a slow reader cannot put back an old copy. Fills use only primary reads.
- A session copy is used only when its `session_host_id` and `host_id` are the host of the object.
- The sign-in check: a copy with `auth_live = 1` is live when the session has no sign-in hash, or
  when the copy is less than 60 s old. Else one replica query on `auth_sessions` checks it. A revoked sign-in is refused within 60 s.
- A listing copy is old when a `current_period_end` in it is in (`checked_at`, now]. So a `past_due`
  license or plan loses its entitlement on time.
- Each session claim names its host, so a read needs no lookup to find the object.

Change paths that invalidate:

| Slice | Change paths |
| --- | --- |
| 1 | `registerHost` (metadata and rotation), `revokeHostCredential`, `handOverHostKey`, `setHostLogo`, `changeMembership`, `acceptOwnerTransfer`, `deleteHost`, `issueHostTicket` (`signal_home = NULL`), `#storeSignalHome` |
| 2 | `acceptInvite`, `joinByCompanySignIn`, `changeMembership`, `endSession`, `endUserSessions` (each host of the ended sessions) |
| 3 | `planChanged`, `licenseChanged` (each host of the owner) |

`startSession` ends only expired sessions and inserts a new one, so it needs no invalidation.
`hidden_at` changes do not change a copy.

## Failed invalidation: outbox retry

When `invalidate()` fails or takes more than 1 s, the Worker writes a marker row to
`remote_auth_events` (`pending_targets = '["host-state:"]'`, payload `{hostId}`) and schedules a retry
after 1 s. The 1 min cron (`SIGNAL_ENTRY_CRON`) calls `retryPendingHostStateInvalidations`, which
retries each marker row and deletes it after a successful invalidation. The auth-event delivery
(`deliverPendingRemoteAuthEvents`) skips the marker rows. So a failed invalidation is applied within about
60 s, and the recheck can be 10 min. In mode `off`, or with no binding, the retry makes no query.

## Consistency

| Change | Seen by the next request | Worst case |
| --- | --- | --- |
| Key rotation, credential revoke, key handover, epoch bump | At once | 60 s (outbox retry) |
| Session end, member removed or added | At once | 60 s (outbox retry) |
| Sign-in session revoked | Within 60 s | 60 s (sign-in recheck) |
| Plan or license change through Stripe sync | At once | 60 s (outbox retry) |
| `past_due` period end | At once (period-end rule) | — |
| Custom member limit written directly in D1, some hosted server state changes | After the recheck | 10 min, display only |

The last row has no invalidation hook: `server_member_limits` is written only by operator scripts,
and the subscription cancel path (`billing-service.ts`) waits for the Stripe webhook sync. Only the
host list display can be old; enforcement reads D1.

## Failure

| Event | Result |
| --- | --- |
| Object call fails or takes more than 1 s | The Worker logs `Host state call failed: <op>` and reads D1, as with mode `off` |
| Cloudflare moves or restarts the object | Copies and generation stay in SQLite |
| Object unavailable for a long time | Each request waits up to 1 s, then reads D1. D1 load goes back to mode `off` |
| Readers reach the object but the cron does not | The 10 min recheck is the limit |
| D1 unavailable | Requests with a fresh copy still work. Others fail as with mode `off` |

## Modes and rollback

| Mode | Reads | Invalidation |
| --- | --- | --- |
| `off` | D1 only, the same queries as before the change | None |
| `write` | D1 only | Yes, with the outbox retry |
| `read` | Object first, D1 on a miss or an error | Yes, with the outbox retry |

Go back: set `HOST_STATE_MODE` to `off`. No data is lost, because the object keeps only copies. To go
from `off` back to `read`, run `write` for at least 10 min first, so that copies from before `off`
are invalidated or old.

No D1 migration is needed.

## Wire compatibility

No route, request, response or ticket changes. Hosts and clients of the last 60 days see the same
protocol. The E2E compares the answers of mode `read` with mode `off`.

## E2E counts

`bun run test:host-state-sessions` (`apps/auth-api/scripts/host-state-sessions-e2e.ts`) and
`bun run test:host-state-object` run on local workerd with local D1 and the object. Both are in
`check:api`. Reports: `.openbot-build/host-state-sessions-e2e/report.json` and
`.openbot-build/host-state-object-e2e/report.json`.

| Case | Mode `off`: primary queries, rows read | Mode `read`: primary queries, rows read |
| --- | ---: | ---: |
| 100 session tickets on the production route, 10 sessions on one host, 30 min (object not read) | 100 replica | 100 replica |
| Host list of a member of 5 hosts, 10 calls in 5 min | 10, 590 | 11, 218 |
| validate-batch of 27 claims (7 host, 20 session), 10 calls in 5 min | 20, 1,410 | 2 (+8 replica), 381 |
| Host authentication, 20 requests on one host (slice 1) | 20 | 1 |

The host list makes 1 more query on a fill, but each query reads 63% fewer rows. The 8 replica queries in
validate-batch check the sign-in of session copies older than 60 s.

## D1 primary queries a minute (estimate)

| Change | Primary queries a day | A minute |
| --- | ---: | ---: |
| Today, normal load | about 13M | about 9,000 |
| validate-batch: about 459k calls, 2 primary queries each, −70% | −0.64M | −445 |
| Host credential (slice 1, upper limit) | −1.82M | −1,264 |
| After slices 1 to 3 | about 10.5M | about 7,300 |

The host list removes no queries, but it removes about 63% of its rows read and its JSON work.

## Cost estimate at 1x of today's load

Prices: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
as written in the measurement notes of 2026-11-27. Not confirmed on the page in this change.

| Item | Price |
| --- | --- |
| Requests | $0.15 per million, 1M included |
| Duration | $12.50 per million GB-s, 400,000 GB-s included |
| SQLite rows read | $0.001 per million |
| SQLite rows written | $1.00 per million (no included amount counted) |
| Storage | $0.20 per GB-month |

Object requests a day:

| Source | Arithmetic | Requests a day |
| --- | --- | ---: |
| Host list | 1.04M calls × 2 hosts (estimate) reads + 10% fills | 2.29M |
| validate-batch | 459k calls × 2 hosts (estimate) | 0.92M |
| Host authentication (slice 1) | 1.82M reads + 10% fills | 2.0M |
| Invalidations | 0.21M host writes + 0.1M session and membership writes (estimate) | 0.31M |
| Total | | about 5.52M a day, 166M a month |

SQLite rows written a day: listing fills 0.52M (1.04M × 5 hosts × 10%, upper
limit) + credential fills 0.53M (3,650 active hosts × 144 fills, estimate) + invalidations 0.93M
(0.31M × 3 rows) = 1.97M a day, 59M a month.

| Item | Arithmetic | A month |
| --- | --- | ---: |
| Requests | (166M − 1M) × $0.15 / 1M | $25 |
| Duration | 166M × 5 ms × 0.128 GB = 106k GB-s, less than 400k included | $0 |
| Rows written | 59M × $1.00 / 1M | $59 |
| Rows read | less than 1B × $0.001 / 1M | less than $1 |
| Storage | less than 1 GB | less than $1 |
| Total at 1x | | about $85 |

At 100x this model gives about $8,500 a month. Most of it is rows written by fills. To lower it, keep
the recheck at 10 min or longer, and fill only the keys that a request needs (the code does this).

## Problems (numbers)

1. **100x needs the sign-in session read to leave D1.** Slices 1 to 3 remove at most about 2.5M of
   26.9M queries a day (9%). The sign-in session read (29.4%) stays. The plan for it is signed
   access tokens.
2. **Rollback barrier.** After production gets the `new_sqlite_classes` migration, a rollback to a
   Worker version before it may be refused (not confirmed). So the binding and the migration tag ship
   alone, with mode `off`.
3. **Latency.** Each request in mode `read` adds 1 object call for each host. A miss adds a fill
   call and a D1 read. A failing object adds up to 1 s to each request until it recovers.
4. **One flag for all hosts.** `HOST_STATE_MODE` has no percentage. The D1 fallback and the outbox
   retry make a global switch safe enough, because the object keeps only copies.

## Production deploy

| Step | Change | Approval |
| --- | --- | --- |
| 1 | Merge slices 1 to 3. Mode `off`. Binding and migration only in `env.test` | PR review. The deploy makes no production change |
| 2 | Add the `HOST_STATE` binding and the migration tag `host-state-v1` (`new_sqlite_classes: ["HostState"]`) to production and preview `wrangler.jsonc`, mode `off` | Developer approval for the migration tag (rollback barrier) |
| 3 | `HOST_STATE_MODE` = `write` | Watch the `Host state call failed` log count, the `host-state:` marker rows and the object request count for 1 day |
| 4 | `HOST_STATE_MODE` = `read` | Watch D1 primary queries a minute, 7429 errors at the next Signal restart, and the object bill |

Go back at any step: set `HOST_STATE_MODE` to `off` and deploy. To remove the class, a
`deleted_classes` migration deletes the object storage (only copies).

## Unconfirmed claims

| Claim | Where I looked |
| --- | --- |
| Durable Object list prices and included amounts | Measurement notes of 2026-11-27; the Cloudflare pricing page was not read in this change |
| 5 ms of billed duration for each object call | Not measured; local workerd does not report billed duration |
| 2 hosts on average in a host list and in a validate-batch call | Not measured; 3.37M rows read for 1.04M host lists is the only signal |
| 3,650 active hosts, 0.1M session and membership writes a day | Estimates; no count in the measurement data |
| validate-batch calls a day (459k) | Route share (3,533 / 16,180) times 2.1M tickets; not counted |
| Rollback across a Durable Object migration is refused | Not tested; no Cloudflare API call was made |
