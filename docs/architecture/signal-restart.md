# Signal restart

A Signal home (`remote/api`) holds the WebSocket of each host, client and ingress connection. Before
this change, a restart closed all of them at once. On 2026-11-27 a signal1 restart sent 24.5k D1
queries per minute for 3 minutes (the D1 primary refuses near 23k), and Signal closed 43,877 sockets
with 1013. This page describes how a home now restarts with no gap, and what it keeps after a crash.

## Layouts

| Layout | Services | Restart |
| --- | --- | --- |
| single (default) | `remote-api` with a Docker port map | Cold. All sockets close. The snapshot keeps the refusals and the trust. |
| slots | `remote-api-blue` and `remote-api-green`, profile `slots`, `network_mode: host` | Handoff with `remote/scripts/signal-handoff.sh`. No socket closes before the new process listens. |

The slots layout needs the Nginx proxy (`REMOTE_SIGNAL_BIND_ADDRESS=127.0.0.1`, port 8081). The slots
run as the image user `bun` and cannot bind port 443. Each slot listens on the same Signal port with
`reusePort`. Linux spreads new connections between the two processes (`SO_REUSEPORT`, same user ID).
Each slot has its own health port on 127.0.0.1: blue 9642, green 9643. The health port of the other
slot is the handoff peer port. `/metrics`, `/health/*` and `/handoff/*` are on the health port only.
The slots share the volume `remote-api-state` at `/var/lib/openbot-signal` (mode 700, user `bun`).
The containers stay `read_only`, with `tmpfs` and `no-new-privileges`. `stop_grace_period` is 120 s.

coturn and acme do not change: coturn already uses host networking, and acme writes the same volume.
Nginx keeps `proxy_pass http://127.0.0.1:8081`. The capacity report reads the metrics of each slot
(`SIGNAL_METRICS_URL` is a comma list) and uses the first that answers.

A home moves from single to slots with one cold restart, with developer approval. The
[signal-deploy skill](../../.agents/skills/signal-deploy/SKILL.md) step 6 gives the commands.

## Handoff sequence

1. The script refuses to start when `remote-api` runs, when both slots run, or when the running slot
   is not `ready`.
2. `docker compose up` starts the other slot. Before it listens, the new process sends
   `/handoff/join` to the peer port.
3. The old process seals its state, links as the old side, and answers with the snapshot
   and the Discord flag. It does not drain yet.
4. The new process opens the snapshot, imports the refusals, the cutoffs and the trusted resume
   tokens, and reads the auth events since `writtenAt − 120 s` (3 s limit). Then it listens.
5. While both run, they ping each other every 1 s. Two missed pings unlink the pair, and each process
   continues alone. Trusted resume tokens go to the other process every 250 ms. Auth events and
   used tickets go at once.
6. The script waits up to 120 s for the new slot to be `ready` and `linked`. Else it stops the new
   slot, and the old slot keeps all sockets.
7. `docker compose stop -t 120` sends SIGTERM to the old slot. The old process:
   1. stops listening, so all new sockets go to the new process;
   2. closes the hello of each new socket with 1012;
   3. writes the snapshot and sends its refusals;
   4. closes the ingress sockets in waves of 1 s, and waits up to 5 s for them to go;
   5. hands over the Discord gateway session and the ingress queue (in memory, never on disk);
   6. closes the host and client sockets in waves over `REMOTE_DRAIN_SECONDS` (90 s);
   7. waits until 10 s after the window, closes the rest, flushes the trust, sends `/handoff/leave`
      with the last refusals, and exits.
8. The script prints the drain report and the status of the new slot.

`restart: unless-stopped` does not restart a slot that `docker compose stop` stopped. SIGINT stops
at once with no drain.

## Close code 1012

The old process closes each socket with 1012 (service restart). Step 0 of this change checked each
client. No client treats 1012 in a special way, so each one reconnects as after any other close,
with its resume token, to the same URL. The new process accepts the resume token locally because
the trust came over in the snapshot and the live sync.

| Client | Code | Close handling | Reconnect |
| --- | --- | --- | --- |
| Desktop host Signal socket | `src/renderer/src/features/team/team-webrtc.ts` | 4000 ends the peer. 1008 with `rate_limited` or no refusal holds 60 s. Others reconnect. | 0.5–4 s, then backoff to 30 s |
| Desktop host gateway | `src/main/team-webrtc-host-gateway.ts` | Moves to another home only after 20 s not ready (`SIGNAL_MOVE_AFTER_MS`). | Same URL first |
| Desktop ingress | `src/main/signal-ingress.ts` | Any code: state `unavailable`. | 2 s backoff, plus up to 14 s spread when it was online |
| Client peer (desktop, web, mobile) | `packages/team-client/src/remote-peer.ts` | 1008 holds. Others reconnect. `followHost` only after 2 failed opens or 10 s waiting for the host. | `signalRetryDelay` backoff, resume token kept |

The waves spread the reconnects over 90 s, and the new process checks no trusted token with D1.

## Snapshot

`state-snapshot.ts` writes `signal-state.json` every `REMOTE_STATE_SNAPSHOT_SECONDS` (30 s) and at
a drain. The write is atomic (temporary file, then rename) with mode 600. A join sends the same
sealed state from memory, not from the file.

The snapshot holds IDs and times only: used ticket IDs, revoked auth epochs, revoked and ended
session IDs, route floors, the trusted resume tokens by token ID (`jti`) with host ID, session ID,
auth epoch and expiry, the ticket and route cutoffs, and the time of the last auth event. It holds no
token, ticket, body or secret.

It is sealed with HMAC-SHA256 over `openbot-signal-state-v1.` and the payload, with the key
`REMOTE_SESSION_SECRET`. A process refuses a snapshot when the signature is wrong, when the
`signalId` is not its own, when it is older than 10 minutes, or when it is more than 30 s in the
future.

## Auth event catch-up

The account service keeps each delivered auth event for 24 hours (`remote_auth_events`, migration
0082 adds `attempted_at`). Each delivery attempt sets `attempted_at`. A Signal reads the events
after a cursor `(attemptedAt, eventId)` with the signed route `POST /v2/remote/auth-events`
(`verifyRemoteServiceRequest`, at most 500 rows for each page). An event that was never attempted is
not returned: no Signal saw it, and the outbox delivers it later.

An account service with no route answers 404. Signal then takes the safe path below.

## Safety rules

A home never accepts a revoked session or a used ticket because of a handoff or a restart.

- **Live ticket claim.** While linked, the new process claims each first-use ticket ID through the
  old process (`/handoff/claim-ticket`, 2 s). A ticket that the old process saw is refused. When the
  old process does not answer, the hello closes with 1013 and the ticket is not accepted.
- **Refusal sync.** Revocations, ended sessions and route floors go to the other process at once,
  and again at the drain and at the leave.
- **Snapshot checks.** Signature, `signalId`, age and future skew, as above. A joining process that
  refuses the snapshot of a running process stops, and the old process keeps all sockets.
- **Catch-up before trust.** After a crash, the process imports the trusted resume tokens only when
  the catch-up of the auth events succeeds in 3 s. A trusted token that a refusal covers is not
  imported.
- **Safe path.** When the snapshot is missing or refused, or the catch-up fails, the process keeps
  only the refusals. It checks each resume token and each ticket issued before its start with the
  control plane, as before this change.
- **Handoff routes.** `/handoff/*` answer 404 unless the request is a `POST` from a loopback address
  on the health port with the handoff token (constant-time compare). `REMOTE_HANDOFF_TOKEN` falls
  back to `REMOTE_METRICS_TOKEN` when that has at least 32 bytes. Routes other than `join`,
  `drain` and `status` answer 409 while the process is not linked.
- **Forward marker.** A forwarded request carries a random per-process marker, so a request is
  forwarded at most once and an outside client cannot set it.
- **No disk queue.** The ingress queue goes to the other process over loopback. It is never written
  to disk.

## Crash restart

A process that starts alone reads the snapshot from the volume. It imports the refusals in all
cases. After a successful catch-up it imports the trust and sets the route cutoff to the lower of
its start time and the snapshot cutoff. The ticket cutoff stays at its start time, so each ticket
issued before the start is checked with the control plane again. The brief asked for the snapshot
time; the start time is safer and costs only the checks of tickets from the last 180 s.

A ticket that was used in the last 30 s (one snapshot period) before a crash is not in the snapshot.
While the ticket is still valid (`TICKET_TTL_SECONDS`, 180 s), a second use is possible after the
restart. Before this change every used ticket was forgotten at a restart. A planned handoff has no
such gap, because the claim is live.

## Webhooks and Discord

During a handoff, a webhook can reach either process. When the ingress socket of the host is on the
other process, the request is forwarded once over loopback (15 s). In the short time after an
ingress socket closed and before it connects again, Signal answers 503, and the provider retries.
GitHub does not send a failed delivery again by itself, so a GitHub event in this gap can be lost.
Before this change, a restart lost the GitHub events of all hosts for the time of the restart.

The Discord gateway moves once: the old process sends the session of each shard (session ID, sequence, resume URL) and the
new process resumes it. Discord deliveries that the old process holds go to the new process.

## Metrics

Watch these on the health port of each slot. The counters start at 0 in a new process.

- `openbot_remote_auth_unavailable_total`: the 1013 closes when the control plane does not answer.
  There is no separate counter for each 1013 cause.
- The socket counts in `/handoff/status` (`sockets`, `drain`).
- Worker D1 errors 7429.

## Limits

- Tested on Linux CI only for the connection spread. On macOS the last process that binds gets all
  new connections.
- The script and the slots compose layout were not run on a real home before the first migration.
- An old account service with no catch-up route makes each crash restart take the safe path.
