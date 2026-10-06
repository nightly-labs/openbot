# OpenBot Remote

This directory holds our own control plane for WebRTC connections. The Remote API relays SDP and ICE.
Team files, chats, commands and video never pass through the Remote API or Cloudflare. The exceptions
are the OpenBot Slack app and the OpenBot Discord bot: see [Slack requests](#slack-requests) and
[Discord](#discord).

## Flow

1. The app signs the user in through the Cloudflare API.
2. Cloudflare D1 checks membership and creates a logical session.
3. Cloudflare signs a short ES256 ticket. The ticket names the host, the user, the role, the protocol version and `authEpoch`.
4. The client and the host open `WSS /v1/signal`. Signal validates the ticket locally through JWKS.
5. Signal relays SDP and ICE and issues a `resume token` along with time-limited coturn credentials.
6. Chromium sets up WebRTC. The Team API uses the `rpc`, `events` and `files` channels.
7. ICE picks either a direct `p2p` path or `relay` through this coturn. Cloudflare is never on the data path.

Signal has no database. It stores no tokens, SDP, ICE, file names or message contents. Room and presence
data exist only in process memory.

A `resume token` is valid for 10 minutes. Signal keeps the issued token in a bounded in-memory cache.
A normal reconnect validates that token locally. After a Signal restart the cache is empty, so the first
reconnect for a given token makes one signed request to the control plane. The same request is needed once
the token has expired. The control plane checks the session, the membership and `authEpoch`. Signal then
issues a new token. Subsequent reconnects are local again. There are no heartbeats and no periodic refresh
through Cloudflare.

Ending a session and changing access both write a revocation event to a durable D1 outbox. The Worker tries
to deliver it to Signal immediately. If Signal is unreachable, the Worker retries the delivery from cron. An
ordinary reconnect still does not ask Cloudflare. Ended and expired sessions are removed after the 10-minute
validation window.

## Slack requests

The OpenBot Slack app sends the events and button presses of every workspace to one request URL,
`https://signal.openbot.run/v1/slack/events`. Signal checks Slack's signature with the app's signing
secret, answers Slack's `url_verification` challenge, and reads only the app ID (`api_app_id`) and
the workspace ID. `SLACK_SIGNING_SECRET` is a comma-separated list of `<app ID>:<signing secret>`,
because the production and development apps share Signal. A request must name the app whose secret
signed it, so one app's secret cannot reach the other app's hosts; a malformed value turns off only
the Slack route. Then Signal passes the exact request body to the `ingress` socket of the host that
the app and workspace are linked to, and returns the host's answer, or 503 when no host holds the workspace or the
host does not answer in 2.5 seconds. Slack then sends the request again.

An `ingress` socket names its workspaces with a Slack route ticket: an ES256 JWT with the audience
`openbot-slack-route`, signed by the Worker with `SLACK_ROUTE_PRIVATE_JWK` (key id
`SLACK_ROUTE_KEY_ID`) for the workspaces, each with its app, that the account service links to that
host. Its public key
must be in the ticket JWKS that Signal loads (`REMOTE_TICKET_PUBLIC_JWKS` on the Worker, or
`REMOTE_TICKET_PUBLIC_KEYS` here). Signal does not store or log the body. Without
`SLACK_SIGNING_SECRET`, the Slack route answers 503.

## Discord

The OpenBot Discord bot is one bot for every guild that installs it. Signal holds its bot token
(`DISCORD_BOT_TOKEN`) and its application ID (`DISCORD_APPLICATION_ID`). Without both, or with a
malformed value, Discord is off: Signal logs one line without the value, keeps no Gateway
connection, and `POST /v1/discord/api` answers 503. The remote sessions and the Slack route keep
running.

Signal keeps the bot's Gateway connection with the intents `Guilds`, `GuildMessages` and
`DirectMessages`, and no privileged intent. Discord then gives the bot the text of a message only
when the message mentions the bot. From the Gateway, Signal reads:

- the names of the guilds, channels and threads, and which guild each channel is in;
- each guild message that mentions the bot and that a person wrote. Signal passes the message ID,
  channel, author, text without the bot's mention, the replied message, the Discord CDN addresses of
  the attachments and the time to the `ingress` socket of the host that the guild is linked to;
- each press of an OpenBot button. Signal acknowledges it to Discord at once and passes it on;
- the removal of the bot from a guild, which ends that guild's connection on the host.

A direct message to the bot gets one fixed answer, at most once an hour for each user. Signal does not
pass it on.

An `ingress` socket names its guilds with a Discord route ticket: an ES256 JWT with the audience
`openbot-discord-route`, signed by the Worker for the guilds that the account service links to that
host. Its public key must be in the ticket JWKS that Signal loads, as for the Slack route ticket. The
account service revokes a guild link through `/internal/auth-events`. After a start, Signal asks the
account service which links are current until every older ticket has expired.

A socket that holds at least one guild gets a `discord-session` token. The host sends it as the
bearer of its calls to `POST /v1/discord/api`: post, edit or delete a message, add or remove a
reaction, read the messages after one message, read a member or channel name, answer a button press,
and upload one file of at most 10 MB. Signal makes each call with the bot token, only in a guild that
is routed to that socket, and only in a channel of that guild. No post can ping anyone. The token is
valid while the socket is open.

So the answers and files of Discord conversations pass through Signal. Signal does not store them or
log them, and it does not log a token or Discord's error text.


- Linux with Docker Engine and Docker Compose.
- A static public IPv4 address.
- `signal.openbot.run` and `turn.openbot.run` records in DNS only mode.
- Open ports TCP 443, TCP/UDP 3478, TCP 5349 and UDP 49152-65535.
- A Cloudflare token scoped to DNS edit for the `openbot.run` zone.

The `signal.openbot.run` and `turn.openbot.run` records must be in **DNS only** mode. Do not enable the
Cloudflare proxy for them. `api.openbot.run` stays a Cloudflare Worker.

If you already run a reverse proxy on port `443`, set `REMOTE_SIGNAL_BIND_ADDRESS=127.0.0.1`,
`REMOTE_SIGNAL_PUBLIC_PORT=8081`, `REMOTE_SIGNAL_PORT=8081` and `REMOTE_TLS_DISABLED=true`. The reverse proxy
must terminate TLS and forward the WebSocket to `http://127.0.0.1:8081`. Also set
`REMOTE_TRUST_PROXY=true` so the IP limits use the client address from `X-Forwarded-For`.

The configuration in `nginx/signal.openbot.run.conf` uses the certificate from the ACME volume. Install
`openbot-remote-nginx-reload.path` and `openbot-remote-nginx-reload.service` into `/etc/systemd/system/` as
well. The unit reloads Nginx after the certificate is renewed:

```sh
sudo cp remote/nginx/openbot-remote-nginx-reload.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openbot-remote-nginx-reload.path
```

Production secrets are stored in the tracked `.env.production` file as encrypted Dotenvx values.
The private decryption key lives only in the ignored `remote/.env.keys` file. Do not pass the encrypted
file straight to `docker compose --env-file`, because Compose will not decrypt the values.
The `remote:*` scripts run Compose through Dotenvx and decrypt the values only in process memory.
The `--overload` option keeps empty host environment variables from overriding the decrypted values.
The scripts use `remote/bin/dotenvx`. The wrapper picks the pinned Node from the application runtime if the
system Node is too old.

Validate the environment and start the services:

```sh
bun run remote:env:validate
bun run remote:up
bun run remote:check
```

Updating Signal may close the WebSocket. An active WebRTC connection stays up. `remote:update` puts coturn
into drain and waits for the allocations to finish. A single coturn instance is no protection against machine
failure. Forcing a coturn restart ends active relay sessions. The client performs an ICE restart and resumes
a file transfer from the last acknowledged offset once the service is back.

Current hosts advertise `multiplex: true` and support independent device sessions at the same time.
Reconnecting one session replaces only that session's Signal socket. Disconnecting or revoking one device
must not end another device's session. Legacy hosts that omit `multiplex` keep the one-client limit:
a second session receives `host_busy` without interrupting the first.

`REMOTE_MAX_CONNECTIONS_PER_USER` (default 32) limits the authenticated Signal sockets of one account.
Published hosts and clients share it. Each open desktop, phone, or browser keeps a socket for each
saved host. A reconnect of the same session does not count its old socket. Change the value on the
Signal server: a desktop environment does not change it.

See [the issue #325 deployment procedure](../docs/remote-session-deployment.md) for the production evidence,
a Signal-only update, rollback commands, and the required desktop/mobile checks.

To run Signal with your own account service, see [Self-hosted remote access](../docs/self-hosting.md).
