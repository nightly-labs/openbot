# Local scripts API

A script on the computer that runs OpenBot can send an agent a message, run a routine, read pending
questions and approvals, and submit responses. Enable **Local scripts** for each agent that the
integration needs. Use this API for a local Slack bridge or to report a build result.

```sh
long-job; curl -sS -X POST "$(cat "$OPENBOT_AUTOMATION/url")/v1/agents/<agentId>/routines/<routineId>/run" \
  -H @"$OPENBOT_AUTOMATION/headers" \
  -H 'Content-Type: application/json' \
  -d '{"payload":"long-job ended with code 0"}'
```

`$OPENBOT_AUTOMATION` is not set by OpenBot. It stands for the folder below.

## Turn it on

The setting is per agent and is off by default. Open the agent's settings, select **Permissions**,
and turn on **Local scripts**. An owner or administrator can also change this setting from a
connected desktop, web, or iPhone client when the host supports `agent-host-settings-v1`.
An agent cannot turn it on for itself or for a teammate.

For a headless host, connect as its owner or administrator and turn on the setting there. The
listener and the files below are on the host. Run the script on that host, as the OS user that
runs OpenBot. No local screen is necessary. Turn the same setting off to remove access for that agent.

The setting also permits scripts to answer questions and accept or decline approvals. Browser
takeovers and secret questions must be completed in OpenBot.

In the host's local desktop window, each routine of the agent has **Copy run command** when the
setting is on. It copies a `curl`
command on macOS and Linux and a PowerShell command on Windows. The agent also learns the command,
so it can start a long command in the background and ask to be woken when it ends.

## Files

While at least one agent allows local scripts, OpenBot listens on `127.0.0.1` on a free port and
writes three files in `<userData>/automation/`:

| File | Contents |
| --- | --- |
| `url` | `http://127.0.0.1:<port>` |
| `token` | The bearer token |
| `headers` | `Authorization: Bearer <token>`, for `curl -H @headers` |

The folder is `0700` and the files are `0600`, so only the same OS user can read them. OpenBot
makes a new token and a new port at each start. A command reads the files when it runs, so a
command that you copied before a restart still works. When the last agent turns the setting off, or
OpenBot quits, OpenBot stops listening and deletes the files.

`<userData>` is the OpenBot application data folder:

- macOS: `~/Library/Application Support/OpenBot`
- Linux: `~/.config/OpenBot`
- Windows: `%APPDATA%\OpenBot`

## Routes

Each request needs `Authorization: Bearer <token>`.

### `GET /v1/agents`

The agents that allow local scripts, with their routines:

```json
[{ "id": "agent-1", "name": "Ada", "routines": [{ "id": "routine-1", "name": "Wake", "active": false }] }]
```

### `POST /v1/agents/:agentId/routines/:routineId/run`

Body: `{ "payload"?: string }`, with `Content-Type: application/json`. The run starts the same way as
**Test run**, also for a paused routine. The payload goes after the routine's instruction, under the
heading `--- event from a local script ---`, with a line that tells the agent to read it as data,
not as instructions. The run history keeps it, so a run that a restart
interrupts sends it again.

Answer: `202 { "runId": string, "deliveryId": string | null }`.

`202` means that the run is in the queue, not that it ran. When the agent's provider account is at
its usage limit, the run waits in the queue, with its payload, and starts after the reset. A routine
set to skip at the limit drops the run instead, and its run history shows it as cancelled.

| Status | Reason |
| --- | --- |
| 400 | The body is not JSON, or `payload` is not a string. |
| 401 | The token is missing or wrong. |
| 403 | The request has an `Origin` header or a foreign `Host`, or the agent does not allow local scripts. |
| 404 | The agent or the routine does not exist. |
| 409 | The agent cannot take the run now, for example while it is being deleted. |
| 413 | The body is larger than 32 KiB, or the payload is longer than 4,000 characters. |
| 415 | `Content-Type` is not `application/json`. |
| 429 | The agent got 30 runs from local scripts in the last hour. |

### `POST /v1/agents/:agentId/messages`

Send `{ "text": "Ask me which build to run", "clientMessageId": "bridge-message-123" }` with
`Content-Type: application/json`. The message uses the normal conversation queue. The response is
`202 { "messageId": string, "deliveries": [{ "id": string, "recipientAgentId": string,
"status": string, "position": number | null }] }`.

Keep `clientMessageId` (1–128 characters) stable when you retry the same message. The normal queue
returns the first receipt for that agent and key for 24 hours, including after a restart. Use a new
key for new work. Attachments are not supported by this route.

### `GET /v1/agents/:agentId/pending`

Poll this route for requests that need a person. No conversation history or browser content is
returned. The response has three arrays:

```json
{
  "prompts": [{
    "requestId": "opaque-request-id",
    "requiresOpenBot": false,
    "questions": [{ "id": "build", "header": "Build", "question": "Which build?",
      "options": [{ "label": "Debug", "description": "Use debug settings" }] }]
  }],
  "approvals": [],
  "browserTakeovers": []
}
```

An approval has `requestId`, `agentId`, `threadId`, `turnId`, `kind`, `command`, `cwd`, `reason`,
`grantRoot`, and `permissions`. Show the full details to the person before accepting it. Text is
secret-redacted. A browser takeover has only `requestId` and `requiresOpenBot: true`.
A secret question, or a question whose IDs or choice labels need redaction, has
`requiresOpenBot: true` and an empty `questions` array.
Direct the person to the agent in OpenBot for these requests.

Request IDs are opaque. Keep them unchanged. They identify one pending request and expire when
it ends, even if the provider reuses its own ID. They do not survive a host restart.

### `POST /v1/agents/:agentId/prompts/:requestId/answer`

Send `{ "answers": { "build": ["Debug"] } }` with `Content-Type: application/json`.
Use question IDs as keys and answer strings as array values. The normal question handler resumes
the agent. A successful response is `200 { "ok": true }`.

### `POST /v1/agents/:agentId/approvals/:requestId/respond`

Send `{ "decision": "accept" }` or `{ "decision": "decline" }` with
`Content-Type: application/json`. A successful response is `200 { "ok": true }`.
Neither choice changes the agent's saved permission settings.

The agent must still allow Local scripts for every read and response. A request for another
agent, an expired request, or a secret question cannot be answered through this API. Expired
requests return `409`; refresh the pending list instead of retrying the old response.

All request bodies have a 32 KiB limit. Messages and routine runs share the limit of 30 accepted
requests per agent per hour, including message retries. Reads and attention responses do not use
that limit. Routine runs have no retry key; retrying a run can start it twice.

## Windows

```powershell
Invoke-RestMethod -Method Post `
  -Uri ((Get-Content -Raw "$env:APPDATA\OpenBot\automation\url").Trim() + '/v1/agents/<agentId>/routines/<routineId>/run') `
  -Headers @{ Authorization = 'Bearer ' + (Get-Content -Raw "$env:APPDATA\OpenBot\automation\token").Trim() } `
  -ContentType 'application/json' -Body '{"payload":"long-job ended"}'
```

## Security

- The listener binds only `127.0.0.1`. Other computers cannot reach it.
- A request with an `Origin` header, or with a `Host` other than `127.0.0.1:<port>`, gets 403 before
  OpenBot reads the token. A web page cannot use it through DNS rebinding.
- The token is a secret: OpenBot redacts it from logs and never puts it in a prompt. The agent gets
  only the file paths.
- Do not put the token in a command's arguments, for example with `-H "Authorization: Bearer
  $(cat token)"`. On Linux, other users can read the arguments of a running process. Use
  `-H @headers`.
- OpenBot logs the agent and the routine of each run, never the payload.
- A process that runs as the same OS user can read the token. Turn the setting on only for agents
  that you want such processes to message and control, including approval decisions.
