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
curl --fail --silent --show-error https://signal.openbot.run/health/ready
curl --fail --silent --show-error https://signal.openbot.run/health/live
curl --fail --silent --show-error https://signal.openbot.run/health/turn
```

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

## Standby Signal

The ssh host `signal2` (`65.109.88.58`) runs a standby copy of Signal, coturn and Nginx in the
Compose project `openbot-remote`, next to an IOTA validator. It gets no traffic: clients, hosts, the
Worker, Slack, Telegram and routine webhooks all use `signal.openbot.run`, which points to
`sui-alexandria`.

- `signal2.openbot.run` and `turn2.openbot.run` point to the standby (DNS only). Check it with
  `curl --fail https://signal2.openbot.run/health/ready`.
- Its certificate covers `signal.openbot.run`, `turn2.openbot.run` and `signal2.openbot.run`
  (`ACME_EXTRA_DOMAINS=signal2.openbot.run`).
- Its `/opt/openbot/remote/.env.production` is a copy of the production file with these changes:
  `TURN_DOMAIN=turn2.openbot.run`, `TURN_PUBLIC_IP=65.109.88.58`, `ACME_EXTRA_DOMAINS`,
  `REMOTE_SIGNAL_PUBLIC_PORT=8091`, and empty `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID` and
  `TELEGRAM_WEBHOOK_ORIGIN`. `REMOTE_SIGNAL_BIND_ADDRESS=127.0.0.1` comes from the production file;
  Docker ports skip ufw, so do not change it. Do not copy the production file over it.
- Discord is off on the standby. Two Signals with the bot token both open a Gateway, and each event
  arrives twice. With an empty `TELEGRAM_WEBHOOK_ORIGIN`, the standby does not set the webhook, which
  already names `signal.openbot.run`.

- The IOTA node uses ports 8080 and 8081, so Signal listens on `127.0.0.1:8091`. Apache uses port 80.
- Nginx uses `remote/nginx/signal.openbot.run.conf` with `signal2.openbot.run` added to `server_name`,
  `proxy_pass` to port 8091, and no port 80 server. The reload units are the ones in `remote/nginx`.
- The firewall (ufw) allows 443/tcp, 3478/tcp, 3478/udp and 5349/tcp, as on production. Neither
  host opens the coturn relay range UDP 49152-65535 that `remote/README.md` lists.
- Tags before `ACME_EXTRA_DOMAINS` lack it in `remote/acme/renew.sh` and `remote/compose.yaml`. For
  such a tag, copy these two files from `main` into the release directory before the build.

Failover: point the `signal.openbot.run` A record to `65.109.88.58`. Nothing else changes. Clients
move when their DNS cache expires and resume as after a Signal restart. Signal sends `turn2` in its
TURN credentials, so `turn.openbot.run` does not need a change. Discord stays off until failback.
Failback: point the record back to `sui-alexandria`.

After each Signal deployment, stage and build the same commit on the standby with the same commands,
and start `remote-api` there. Send the two `curl` checks to `signal2.openbot.run`, not to
`signal.openbot.run`, which reaches production.

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
