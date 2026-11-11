# Concurrent remote sessions: issue #325

## Read-only production evidence

Checked on 2026-09-08. No production changes were made for this investigation.

- SSH target: `sui-alexandria`. Compose directory: `/opt/openbot/remote`.
- Signal container: `openbot-remote-remote-api-1`, created `2026-09-01T10:53:29.873613544Z`.
- Running image: `sha256:7f94a50aee8b89ccf16803c0b9811f6fe19a5d876d14cfeed51deb97e4eee6dd`.
- Running `signal-service.ts` SHA-256: `b1514f74e6b2ff708c430154b793261a667b5b107c69ee6bd79e6c0fd2356efc`.
  Its client admission code rejects every different session when a host already has a connection.
  Its protocol parser has no `multiplex` field. This confirms that this image lacks multiplex support.
- Latest Worker version observed: `bf613b5c-8c44-4c73-8226-1c2651bab5c7`, version number 265,
  created `2026-09-08T09:16:13.382129Z`, deployed at 100% at `2026-09-08T09:16:14.464933Z`.
  This is version evidence, not an end-to-end compatibility result.
- D1 records `0018_remote_device_sessions.sql` as applied at `2026-09-04 12:21:44`.
  The SELECT changed no data. Do not apply this migration again or reverse it.
- `/opt/openbot` is not a Git checkout. The public Signal health routes do not identify the source version.

To repeat the read-only checks, run from this repository:

```sh
ssh sui-alexandria 'docker inspect openbot-remote-remote-api-1 --format "{{.Image}} {{.Created}}"'
ssh sui-alexandria 'docker exec openbot-remote-remote-api-1 sha256sum /app/remote/api/src/signal-service.ts'
bunx wrangler deployments list --cwd apps/auth-api --json
bunx wrangler d1 execute openbot-auth --cwd apps/auth-api --remote \
  --command "SELECT name, applied_at FROM d1_migrations WHERE name = '0018_remote_device_sessions.sql'" --json
```

## Deployment procedure — requires separate approval

Commit and check the intended source before deployment. Use the approved commit as `HEAD` below.
Run the required CI checks first. If the target environment lacks the device-session schema or Worker,
apply the compatible additive D1 migrations before deploying the Worker. Use the existing production
CI deployment procedure. Do not infer Worker compatibility from its date alone.

Stage the approved source on the host without replacing its configuration or key files:

```sh
release_dir="/opt/openbot/releases/$(git rev-parse HEAD)"
ssh sui-alexandria "mkdir -p '$release_dir'"
git archive HEAD | ssh sui-alexandria "tar --exclude='.env*' --exclude='*/.env*' -x -C '$release_dir'"
ssh sui-alexandria "ln -s /opt/openbot/remote/.env.production '$release_dir/remote/.env.production'"
ssh sui-alexandria "ln -s /opt/openbot/runtime '$release_dir/runtime'"
ssh sui-alexandria "ln -s /opt/openbot/node_modules '$release_dir/node_modules'"
ssh sui-alexandria "ln -s /opt/openbot/remote/.env.keys '$release_dir/remote/.env.keys'"
```

The runtime and dependency links let the existing Dotenvx wrapper run. Docker installs Signal
dependencies from the approved lockfile inside the image.

On `sui-alexandria`, change to that release directory. Retain the running image **before** the build.
Run only these Signal commands; `remote:update` also updates coturn and is not appropriate here.

```sh
signal_previous_image=$(docker inspect openbot-remote-remote-api-1 --format '{{.Image}}')
docker image tag "$signal_previous_image" openbot-remote-api:before-325
# The release directory is named after the commit. `/health/live` shows it after the start.
source_commit=$(basename "$PWD")
printf '%s\n' "$source_commit" | grep -Eqx '[0-9a-f]{40}' || { echo "Not in a release directory." >&2; exit 1; }
remote/bin/dotenvx run --overload -f remote/.env.production -fk remote/.env.keys -- \
  docker compose -p openbot-remote -f remote/compose.yaml build --build-arg "OPENBOT_SOURCE_COMMIT=$source_commit" remote-api
remote/bin/dotenvx run --overload -f remote/.env.production -fk remote/.env.keys -- \
  docker compose -p openbot-remote -f remote/compose.yaml up -d --no-build --no-deps remote-api
docker inspect openbot-remote-remote-api-1 --format '{{.Image}} {{.State.Health.Status}}'
curl --fail --silent --show-error https://signal1.openbot.run/health/ready
curl --fail --silent --show-error https://signal1.openbot.run/health/live
curl --fail --silent --show-error https://signal1.openbot.run/health/turn
```

Use `signal1.openbot.run`, not `signal.openbot.run`: the entry name can point to `signal2`.

`/health/turn` makes one real UDP allocation on the TURN server of `TURN_HOST` and frees it. It answers
503 with `turn_full` when coturn refuses the allocation at its quota. The result stays cached for one
minute. The status page probes it for "Connections".

`/health/live` must show the release commit. Builds made before this field existed show no `commit`;
builds made without `OPENBOT_SOURCE_COMMIT` show `unknown`.

Wait for Docker health to become `healthy`. Check the running source for `multiplex` and record its
checksum. Keep the previous image until the device checks below pass. Do not print container environment
variables, resume tokens, tickets, or raw connection logs.

The capacity reporter (`capacity-report`) uses the Signal image and sends `signal_capacity`
(ANALYTICS.md) every 5 minutes. It reads the coturn metrics on `127.0.0.1:9641` and the Signal metrics
on `127.0.0.1:9642`. It needs `OPENPANEL_CLIENT_ID` and `OPENPANEL_CLIENT_SECRET` in the host
`.env.production`, the server client of `apps/auth-api/.env.production`; without them it exits at start
and stays stopped. Build and start it after `remote-api`, with the same `--build-arg`:

```sh
remote/bin/dotenvx run --overload -f remote/.env.production -fk remote/.env.keys -- \
  docker compose -p openbot-remote -f remote/compose.yaml build --build-arg "OPENBOT_SOURCE_COMMIT=$source_commit" capacity-report
remote/bin/dotenvx run --overload -f remote/.env.production -fk remote/.env.keys -- \
  docker compose -p openbot-remote -f remote/compose.yaml up -d --no-build --no-deps capacity-report
docker logs openbot-remote-capacity-report-1 2>&1 | tail -5
```

A failed sample writes only `Capacity report failed.` and its source (`turn`, `signal` or `openpanel`).

### coturn configuration update

A change to `remote/coturn/` needs a new coturn container. The restart ends the relay allocations of
that machine: its clients that use the relay lose their path, get the other relay from Signal, and
restart ICE. Do it in a quiet hour, one machine at a time, and only with approval.

1. Open the relay range of the new `turnserver.conf` in the firewall of both machines first. If coturn
   gets ports before the firewall allows them, the firewall drops the first packets of the peers:

   ```sh
   ufw allow 16384:65535/udp comment 'OpenBot TURN relay UDP'
   ```

   A narrower older rule, such as `49152:65535/udp`, is then not necessary. Remove it after both
   machines run the new range.
2. Stage the release directory as above. In it, keep the running image and build coturn:

   ```sh
   docker image tag "$(docker inspect openbot-coturn --format '{{.Image}}')" openbot-remote-coturn:before-<sha>
   remote/bin/dotenvx run --overload -f remote/.env.production -fk remote/.env.keys -- \
     docker compose -p openbot-remote -f remote/compose.yaml build coturn
   remote/bin/dotenvx run --overload -f remote/.env.production -fk remote/.env.keys -- \
     docker compose -p openbot-remote -f remote/compose.yaml up -d --no-build --no-deps --force-recreate coturn
   ```

   `--no-deps` keeps `acme` as it is. coturn depends on it, and without the option Compose can
   recreate it too.
3. Check the configuration that coturn uses, then the relay:

   ```sh
   docker exec openbot-coturn grep -E '^(min-port|max-port|total-quota)=' /tmp/openbot-turnserver.conf
   curl --fail --silent --show-error https://signal1.openbot.run/health/turn
   curl --fail --silent --show-error https://signal2.openbot.run/health/turn
   curl -s 127.0.0.1:9641/metrics | grep '^turn_total_allocations'
   ```

   The allocations come back in a few minutes. Wait until `openbot_remote_turn_relay_available` is 1
   for this relay on both Signals, then do the other machine.

To roll back, tag `openbot-remote-coturn:before-<sha>` as `openbot-remote-coturn` and recreate coturn
with the same `up` command.

Signal replacement closes signaling WebSockets. Existing WebRTC data channels should continue while
signaling reconnects. The first resume after a restart checks the durable control plane. When the
account service does not answer, Signal closes the socket with 1013 and no error frame, and the peer
connects again after its backoff; the session does not end. Coturn stays
running, so the update does not deliberately end its relay allocations. Validate this with an active
connection; health checks alone do not prove it.

If the new Signal fails, restore the retained image from the same release directory:

```sh
docker image tag openbot-remote-api:before-325 openbot-remote-remote-api
remote/bin/dotenvx run --overload -f remote/.env.production -fk remote/.env.keys -- \
  docker compose -p openbot-remote -f remote/compose.yaml up -d --no-build --no-deps --force-recreate remote-api
```

Rollback restores the old one-session limit. It does not reverse D1 migrations or revoke device sessions.

## Second Signal machine

The machine `signal2.openbot.run` (`65.109.88.58`, ssh as `root`) runs a second copy of Signal,
coturn and Nginx in the Compose project `openbot-remote`, next to an IOTA validator. Since 2026-10-31
(#4309) both machines hold rooms (see [Two active Signal machines](#two-active-signal-machines)):
`sui-alexandria` is home `a` (`signal1.openbot.run`) and this machine is home `b`. The entry name
`signal.openbot.run` can point to either machine, and the Worker moves it when the entry machine
fails. To reach one machine, use `signal1.openbot.run` or `signal2.openbot.run`. Its coturn is the
second TURN relay (see [TURN relays](../remote/README.md#turn-relays)).

- `signal2.openbot.run` and `turn2.openbot.run` point to this machine (DNS only). Check it with
  `curl --fail https://signal2.openbot.run/health/ready`.
- Its certificate covers `signal.openbot.run`, `turn2.openbot.run` and `signal2.openbot.run`
  (`ACME_EXTRA_DOMAINS=signal2.openbot.run`). The certificate of `sui-alexandria` covers
  `signal.openbot.run`, `signal1.openbot.run` and `turn.openbot.run`.
- Its `/opt/openbot/remote/.env.production` is a copy of the production file with these changes:
  `TURN_DOMAIN=turn2.openbot.run`, `TURN_PUBLIC_IP=65.109.88.58`, `ACME_EXTRA_DOMAINS`,
  `REMOTE_SIGNAL_PUBLIC_PORT=8091`, `TURN_EXTRA_HOSTS=turn.openbot.run`, `SIGNAL_ID=b` and
  `SIGNAL_PUBLIC_IPV4=65.109.88.58`. `REMOTE_SIGNAL_BIND_ADDRESS=127.0.0.1` comes from the production file;
  Docker ports skip ufw, so do not change it. Do not copy the production file over it.
- The Discord, Telegram and Slack values are the same as on `sui-alexandria`. Only the entry machine
  starts the bots; `openbot_remote_signal_entry` in `/metrics` is 1 there.

- The IOTA node uses ports 8080 and 8081, so Signal listens on `127.0.0.1:8091`. Apache uses port 80.
- Nginx uses `remote/nginx/signal.openbot.run.conf` with `signal2.openbot.run` added to `server_name`,
  `proxy_pass` to port 8091, and no port 80 server. The reload units are the ones in `remote/nginx`.
- The firewall (ufw) allows 443/tcp, 3478/tcp, 3478/udp, 5349/tcp and the coturn relay range UDP
  16384-65535, as on production (see [coturn configuration update](#coturn-configuration-update)).
- Nginx has `worker_rlimit_nofile 65535`, `worker_connections 8192` and `reuseport`, as on production
  ([production requirements](../remote/README.md#production-requirements)). With the Nginx default of
  768 connections, this machine holds only about 12,000 Signal sockets, less than both machines have
  together.
- Tags before `ACME_EXTRA_DOMAINS` lack it in `remote/acme/renew.sh` and `remote/compose.yaml`. For
  such a tag, copy these two files from `main` into the release directory before the build.

TURN relays: production sets `TURN_EXTRA_HOSTS=turn2.openbot.run`, so each Signal gives each host
`turn` or `turn2`. Both coturns must have the same `TURN_SHARED_SECRET`. Compare it by hash on the two
hosts before you set `TURN_EXTRA_HOSTS`. Deploy a Signal that knows `TURN_EXTRA_HOSTS` (it is in
`remote/compose.yaml`) before you set it; an older Signal ignores it. To take a relay out, remove it
from `TURN_EXTRA_HOSTS` and recreate `remote-api`, or stop its coturn: Signal stops giving it to new
peers in about a minute.

Failover is automatic: see "What moves when a machine stops" below. Each Signal gives its own relay
first and skips a relay that does not allocate, so a TURN name does not need a change.

After each Signal deployment, stage and build the same commit on `signal2` with the same commands,
and start `remote-api` there. Send the `curl` checks to `signal2.openbot.run`.

## Two active Signal machines

Live since 2026-10-31 (#4309). The steps below record how it was set up; repeat them only for a new
machine, and get approval for each one. Both machines hold rooms at the same time. The Worker gives each current
host a home machine, and the host's devices meet it there. The bots, `ingress` sockets and released
hosts stay on the entry machine, which `signal.openbot.run` names. Each step below is a production
change, and each one needs its own approval.

1. DNS (DNS only, not proxied): add `signal1.openbot.run` → `95.216.243.233`. `signal2.openbot.run`
   already exists. Add `signal1.openbot.run` to `ACME_EXTRA_DOMAINS` on `sui-alexandria` and get the
   certificate. Check `curl --fail https://signal1.openbot.run/health/ready`.
2. Secrets: compare `REMOTE_SESSION_SECRET`, `TURN_SHARED_SECRET` and `REMOTE_AUTH_WEBHOOK_SECRET` by
   hash on the two hosts. Resume tokens and TURN credentials must work on both machines. Do not print
   the values.
3. Signal environment: on `sui-alexandria` set `SIGNAL_ID=a`, `SIGNAL_PUBLIC_IPV4=95.216.243.233`; on
   `signal2` set `SIGNAL_ID=b`, `SIGNAL_PUBLIC_IPV4=65.109.88.58`. On both set
   `SIGNAL_ENTRY_HOST=signal.openbot.run`. Give `signal2` the Discord, Telegram and Slack values of the
   production file: the entry rule starts the bots only on the entry machine.
4. Deploy the same Signal commit to both machines and recreate only `remote-api`. Check
   `openbot_remote_signal_entry` in `/metrics`: 1 on `sui-alexandria`, 0 on `signal2`.
5. Worker variables, after step 4:
   `REMOTE_SIGNAL_HOMES=a=wss://signal1.openbot.run/v1/signal,b=wss://signal2.openbot.run/v1/signal` and
   `REMOTE_AUTH_WEBHOOK_URLS=https://signal1.openbot.run/internal/auth-events,https://signal2.openbot.run/internal/auth-events`.
   Set both in the same deploy: with homes and no `REMOTE_AUTH_WEBHOOK_URLS`, a revoke reaches only
   the entry machine, and revoked devices on the other home keep their sockets.
   Apply D1 migration `0044_remote_signal_homes.sql` before the Worker deploy. Until a desktop release
   that asks for a home, all hosts stay on the entry.
6. Entry failover: set the TTL of the `signal.openbot.run` A record to 60 seconds (it is 300). Make a
   Cloudflare API token with only `Zone.DNS:Edit` on `openbot.run`, and set it as the Worker secret
   `SIGNAL_ENTRY_DNS_TOKEN` (`wrangler secret put`, never in a file or a log). `SIGNAL_ENTRY_ZONE_ID`
   is in `wrangler.jsonc`. The cron `*/1 * * * *` then runs the check
   (`apps/auth-api/src/server/signal-entry-failover.ts`); without the token, it does nothing.

Order: a Signal without `SIGNAL_ID` accepts every `signal` claim, and an older Signal ignores the
claim. So deploy Signal before the Worker variables. To roll back, empty `REMOTE_SIGNAL_HOMES`: new
tickets name the entry again. The `signal_home` column stays.

What moves when a machine stops:

- Its hosts: after 20 seconds without Signal, the host asks the Worker for a new ticket and names its
  home as failed. The Worker gives it the other machine.
- Their clients: after 2 failed sockets, or 10 seconds of `host-waiting`, a client gets a new ticket,
  which names the host's new home. The client drops its resume token, because the other machine does
  not know the socket.
- The entry: each minute the account Worker checks `/health/ready` of the machine that
  `signal.openbot.run` gives. When it fails two checks 20 seconds apart, the Worker sets the record to
  the address of the first other home in `REMOTE_SIGNAL_HOMES` that answers. When no machine answers,
  or the records do not show one entry machine (proxied, two A records, or an address of no home),
  it changes nothing. The name does not go back when the old machine starts again. With the 60-second
  TTL, the name moves in about 2 to 3 minutes. Within about 60 seconds after that, the other machine
  sees its address, becomes the entry and starts the bots. For that time, both machines can run the
  Discord Gateway, and some Discord events can arrive two times. The Worker log shows
  `Signal entry moved.` with the two IDs.

Failover drill (after approval): stop `remote-api` on `signal2`, check that a host with home `b` and
its clients connect on `signal1` within 1 minute, then start it again. Hosts stay on their new home
until it fails, or until it is no longer near (see "Regional Signal machines"). Then do the same for `sui-alexandria` in a quiet hour, which also moves the entry:
check that `dig signal.openbot.run` gives `65.109.88.58` within 3 minutes and that
`openbot_remote_signal_entry` is 1 on `signal2`. To move the entry back, set the A record by hand.

Known limits: the host status shows the home URL from its first ticket and does not change after a
move. A host that goes back to a released desktop sends no `signalHome`; its ticket request removes the
stored home, so its clients go to the entry with it.

## Regional Signal machines

Two Leaseweb VPS machines give hosts far from Helsinki a nearer Signal and TURN relay. Each is a
home like `a` and `b`, but it never holds the entry while `a` or `b` answers.

| Home | Machine | Address | Names | Place |
| --- | --- | --- | --- | --- |
| `us` | `openbot-signal-us` (Leaseweb VPS 12728289, SFO-12, same reference) | `23.106.44.143` | `signal-us`, `turn-us` | San Jose |
| `au` | `openbot-signal-au` (Leaseweb VPS 12728295, SYD-12, same reference) | `23.106.243.56` | `signal-au`, `turn-au` | Sydney |

The AU plan has a 5 TB monthly traffic pack. TURN relay traffic counts against it.

Setup of each machine (Ubuntu 26.04):

1. Key-only SSH, security-only unattended upgrades with no automatic reboot, `ufw` (22, 443/tcp,
   3478 TCP and UDP, 5349/tcp, 16384-65535/udp), the TURN socket buffers and the Nginx limits of
   [remote/README.md](../remote/README.md). The Leaseweb 26.04 image has no GRUB package, so a new
   kernel never starts until `grub-pc` is installed.
2. DNS only, TTL 300: `signal-<home>` and `turn-<home>` → the machine address.
3. `/opt/openbot/remote/.env.production` is a copy of the `signal2` file with these plain values
   changed: `SIGNAL_ID=<home>`, `SIGNAL_PUBLIC_IPV4`, `TURN_PUBLIC_IP`,
   `TURN_DOMAIN=turn-<home>.openbot.run`, `ACME_EXTRA_DOMAINS=signal-<home>.openbot.run`,
   `REMOTE_SIGNAL_PUBLIC_PORT=8081` and an empty `TURN_EXTRA_HOSTS`, so each machine gives only its
   own relay. `SIGNAL_DOMAIN` and `SIGNAL_ENTRY_HOST` stay `signal.openbot.run`: the certificate also
   names the entry, so the machine can take the entry after a failover.
4. Stage the same Signal commit as on `signal1` and `signal2`, build `remote-api`, `capacity-report`
   and `coturn`, and start the project. Before the start, set `{"dns": ["1.1.1.1", "1.0.0.1"]}` in
   `/etc/docker/daemon.json` and restart Docker. The Leaseweb resolver keeps the NXDOMAIN answer for
   the challenge name for 30 minutes, so each certificate attempt fails, and after 5 failures Let's
   Encrypt blocks the name for an hour. Cloudflare serves the `openbot.run` zone, so `1.1.1.1` sees the
   record at once. This is also necessary for each renewal.
5. Nginx: the `signal2` vhost with `server_name signal.openbot.run signal-<home>.openbot.run` and
   `proxy_pass http://127.0.0.1:8081`, plus the `openbot-remote-nginx-reload` path and service units.
6. Check `/health/ready`, `/health/live` (the commit) and `/health/turn` on `signal-<home>`, and
   `openbot_remote_signal_entry` 0.
7. Worker variables: add the home to `REMOTE_SIGNAL_HOMES` after `a` and `b`, its webhook URL to
   `REMOTE_AUTH_WEBHOOK_URLS`, and its place to `REMOTE_SIGNAL_HOME_LOCATIONS`, in one deploy.

Placement: `REMOTE_SIGNAL_HOME_LOCATIONS` gives each home a place as `id=latitude:longitude`. The
ticket route reads the host place from the Cloudflare request (`request.cf`). The Worker keeps the
available homes that are at most 1000 km farther from the host than the nearest one, and picks one of
them with the same rendezvous hash as before. A host keeps its stored home while that home is one of
them; otherwise it moves at its next ticket. A host leaves a stored home that did not fail for it
only when the new home answers `/health/ready` within 2 seconds, so a host that moved away from a
failed near home stays on the far one until the near one is back. A host with no known place, or a Worker with no places,
uses all homes. The value must be empty or name each home one time; an invalid value makes each ticket
request fail with `503 remote_not_configured`. The entry failover tries the homes in list order, so
keep `a` and `b` first.

To roll back one machine, remove it from the three Worker variables in one deploy. Its hosts move at
their next ticket, or after 20 seconds without Signal when the machine is stopped.

## Required device validation — pending

Use a current desktop B as host, desktop A as a client, and a mobile client from a compatible source.
Record their versions, the Worker version, the D1 migration result, and the Signal image.

1. Connect mobile to A, accept B's Member invitation on mobile, then open B on A.
2. Repeat with A joining B before mobile opens B. Both clients must load B's agents and data.
3. Stop A. Mobile must remain connected to B. Repeat with a disconnect of one device session.
4. Reconnect A and verify that its agent list and data refresh. Switch servers during a pending load;
   the old response must not replace the selected server's data.
5. With an older host that omits `multiplex`, connect a second client. It must show a connection error
   and Retry, while the first client remains connected. Retry must retain the error until success.
6. During the approved Signal replacement, check that active data channels survive and that both
   clients can resume signaling. Test a relay connection as well as a direct connection.

Do not close issue #325 until these checks pass. PR #324 remains separate; its invitation UI changes
are not included here. No automatic Signal deployment is added.
