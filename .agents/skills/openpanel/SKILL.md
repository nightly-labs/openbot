---
name: openpanel
description: Query OpenBot product analytics (events, sessions, profiles, funnels, retention, active users, Search Console, and SQL percentiles such as p50/p90/p99) from the self-hosted OpenPanel server, and make or change its dashboards and reports. Use when debugging with real usage data, checking whether an event fires, counting affected users, answering a product or growth question, or building a dashboard.
---

# OpenPanel analytics

`scripts/openpanel.ts` calls the OpenPanel MCP server at `https://analytics.openbot.run/api/mcp`.
The token is a `root` client. It reads analytics and makes, changes and deletes dashboards and
reports (`create_dashboard`, `create_report`, `update_report_layout`, `delete_dashboard` and others).
`apps/auth-api/.env.dev` and `apps/auth-api/.env.production` hold the same token as
`OPENPANEL_MCP_TOKEN`, so either key works.

## Run

When `DOTENV_PRIVATE_KEY_DEV` is in the shell:

```sh
bun scripts/openpanel.ts tools                       # list the tools
bun scripts/openpanel.ts tools <tool>                # show the input schema of one tool
bun scripts/openpanel.ts call <tool> '<json args>'   # call a tool; the result is JSON
```

When the key is not in the shell, use the root `.env.keys` of the main checkout. A worktree has none:

```sh
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
./node_modules/.bin/dotenvx run -q -f apps/auth-api/.env.dev -fk "$MAIN/.env.keys" -- bun scripts/openpanel.ts call list_event_names '{"projectId":"openbot"}'
```

If no key is available, stop and ask the developer. Never print the token, a key, or `.env.keys`.

## Use

- Every tool needs `"projectId": "openbot"`. Nightly, Infeld and other products share the
  organization, and the token can change their dashboards too: do not touch them.
- Event names and properties are in [ANALYTICS.md](../../../ANALYTICS.md). Call `list_event_names`
  or `list_event_properties` when a name is not there.
- Read the schema with `tools <tool>` before the first call of a tool. Most query tools take
  `startDate` and `endDate` (`YYYY-MM-DD`) and use the last 30 days by default.
- Before you change or delete a dashboard that you did not make in this task, ask the developer.
  Check a new report with `get_report_data` and send the developer the `dashboard_url`.
- The server accepts 60 requests per minute from one IP address. Each command is one request, so
  do not loop over many profiles.
- Profiles contain email addresses and account IDs. Do not copy them into issues, pull requests,
  commits or logs. Use counts, or an ID only when the developer asks for one.

## SQL and percentiles

The MCP tools have no percentiles, and `query_events` returns about 12 rows. For p50, p90, p99 and
other aggregations, use `scripts/openpanel-sql.ts`. It runs read-only SQL on the OpenPanel ClickHouse
through an SSH tunnel to `sui-alexandria` (your SSH key must work there). The ClickHouse user
`openbot_readonly` can only `SELECT` from `events`: the `openpanel.events` rows of project `openbot`.
Other products and the other tables are not visible. The server stops a query after 120 s, 4 GiB of
memory or 100,000 result rows, gives it 4 threads, and allows 300 queries per hour.
`OPENPANEL_CLICKHOUSE_USER` and `OPENPANEL_CLICKHOUSE_PASSWORD` are in both env files.

```sh
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
SQL() { ./node_modules/.bin/dotenvx run -q -f apps/auth-api/.env.dev -fk "$MAIN/.env.keys" -- bun scripts/openpanel-sql.ts "$@"; }
SQL presets                                          # list the presets
SQL preset turn-duration                             # completed turns, duration_ms by provider, 30 days
SQL preset resources --by platform,app_version --min-n 200
SQL preset conversation-open --days 7 --format json
SQL preset voice-turn --since 2026-10-01 --until 2026-11-01
SQL query "SELECT properties['model'] AS model, count() AS n FROM events
  WHERE name = 'system_turn_completed' AND created_at > now() - INTERVAL 7 DAY GROUP BY model ORDER BY n DESC"
```

- Each preset row has `n` (samples), `profiles` (distinct profiles), `p50`, `p90`, `p99` and `max`.
  The `(all)` row is the total of the metric. `--metric` measures other numeric properties, `--by`
  groups by allowlisted properties, `--all-results` keeps failed turns, and `--print-sql` shows the
  SQL to change for a raw query.
- Properties are strings in the `properties` map: use `toFloat64OrNull(properties['duration_ms'])`.
  Filter `properties['environment'] = 'production'` (presets do this) and `created_at`. The table is
  sorted by project, day and name, and has projection `p_name` by name, so always filter by `name`.
- Do not add a `FORMAT` clause or `SETTINGS`: the user is `readonly=1`, and the script adds `FORMAT JSON`.
- `system_resources` values are already daily p95 or max values of one computer, so a p99 of
  `db_request_ms_p95` is "the 99th percentile computer-day", not a request percentile.
- Output redacts email addresses and the text values of columns whose name has `profile_id`,
  `device_id` or `session_id`. Counts such as `uniqExact(profile_id)` stay numbers. The match uses
  the column name, so do not rename an identifier column with `AS`, and do not select the whole
  `properties` map. Use `--show-identifiers` only when the developer asks for one ID, and never paste
  identifiers into issues, pull requests or commits.
- With a tunnel that is already open, set `OPENPANEL_CLICKHOUSE_URL=http://127.0.0.1:<port>/`.
  The script reads the container IP for each run, because Docker can change it.

## Release regression report

`.github/workflows/release-regression.yml` runs `scripts/release-regression-report.ts` every day.
The report compares the two newest releases and goes to a private Discord channel: turn time and
first output, startup, failed turns, error codes per 1,000 turns, update failures, and resources
(event loop, stalls, database, memory, renderer crashes, crash loops). Startup and first output show
only when both releases send them. Shares and error rates are red or yellow only when the rise is
also significant (one-sided z of 3.09 or 1.645). An error code counts only when it has 5 events on
3 computers in the new release. When fewer than two releases have 30 computers, the run sends
nothing and does not fail.

The repository is public, so the log must show no data: keep `--quiet`, do not upload the report,
and do not open issues from it. Run it locally without `--discord` to see the table, or with
`--discord` and `RELEASE_REGRESSION_WEBHOOK_URL` to post it.

The scheduled run sends only when a status changed, and on Monday (UTC). A manual run
(`workflow_dispatch`) passes `--always`. The last sent statuses are an HMAC, keyed by the webhook URL,
in the GitHub Actions cache `release-regression-state-*`. Pull requests can read that cache, so do
not put other data in it. A failed run clears the state, so the next good run sends. When a run stops
before the script can do that (the tunnel, a timeout, a cancel), a workflow step clears the state and
posts a notice with no detail.

The secrets are in the `analytics` GitHub environment, which only protected branches can use:
`RELEASE_REGRESSION_SSH_KEY`, `RELEASE_REGRESSION_SSH_KNOWN_HOSTS`, `RELEASE_REGRESSION_SSH_HOST`,
`OPENPANEL_CLICKHOUSE_USER`, `OPENPANEL_CLICKHOUSE_PASSWORD` and `RELEASE_REGRESSION_WEBHOOK_URL`.
Set them with `gh secret set <name> --env analytics < file` or from a pipe; never as an argument.

CI uses its own key, not a developer key. On `sui-alexandria`:

- The user `openpanel-ci` has no shell. Its `authorized_keys` line and a `Match User openpanel-ci`
  block at the end of `/etc/ssh/sshd_config` allow only `-L` to `127.0.0.1:18123`.
- `openpanel-clickhouse-proxy.socket` listens on `127.0.0.1:18123`. Its service runs
  `/usr/local/sbin/openpanel-clickhouse-proxy`, which reads the container IP and starts
  `systemd-socket-proxyd`. The proxy stops after 60 s without a connection.

To change the key, make a new ed25519 key, replace the line in
`/var/lib/openpanel-ci/.ssh/authorized_keys`, and set `RELEASE_REGRESSION_SSH_KEY` again.
To remove the access: delete the `Match User openpanel-ci` block (the backup is
`/etc/ssh/sshd_config.bak-20261104-openpanel-ci`), run `sshd -t` and `systemctl reload ssh`, then
`userdel -r openpanel-ci` and `systemctl disable --now openpanel-clickhouse-proxy.socket`, and delete
the two units and the script.

## Release health check

`scripts/release-health.ts <version | latest>` compares a new release with the release before it over
the same hours after each GitHub Release: finished starts, crashes, startup crashes, quit hangs and
update arrivals, per platform and for servers. It is the check before a staged rollout goes to 100%
(`docs/RELEASING.md`). Exit code 1 means a metric is clearly worse, and 3 means not enough data yet.
`.github/workflows/release-health.yml` runs it every two hours in the first 72 hours of a release
with `--quiet`, and posts worse rows once to the same private channel as the regression report, with
the same secrets and tunnel. Its state cache is `release-health-state-*`, an HMAC as above.

## Rotate the token

In OpenPanel, open the OpenBot project, then Settings, Clients. Make a new `root` client. Encrypt
`base64(<client id>:<client secret>)` as `OPENPANEL_MCP_TOKEN` into both `apps/auth-api/.env.dev`
and `apps/auth-api/.env.production` with `dotenvx set ... -fk <main checkout>/.env.keys`. Then delete
the old client.

## Rotate the ClickHouse password

Make a random password. Put its SHA-256 hex in `<password_sha256_hex>` of user `openbot_readonly` in
`/root/openpanel/self-hosting/clickhouse/clickhouse-user-config.xml` on `sui-alexandria` (back up the
file first, and write it in place: Docker mounts this one file, so a new inode is not seen).
ClickHouse reloads `users.d` without a restart. Encrypt the password as `OPENPANEL_CLICKHOUSE_PASSWORD`
into both env files with `dotenvx set ... -fk <main checkout>/.env.keys`, and set
`OPENPANEL_CLICKHOUSE_PASSWORD` in the `analytics` GitHub environment again.
