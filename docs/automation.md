# Local script runs

A script on the computer that runs OpenBot can run a routine of an agent and give it a payload. Use
this to wake an agent when work outside its turn ends: a build, a download, a long test run.

```sh
long-job; curl -sS -X POST "$(cat "$OPENBOT_AUTOMATION/url")/v1/agents/<agentId>/routines/<routineId>/run" \
  -H @"$OPENBOT_AUTOMATION/headers" \
  -H 'Content-Type: application/json' \
  -d '{"payload":"long-job ended with code 0"}'
```

`$OPENBOT_AUTOMATION` is not set by OpenBot. It stands for the folder below.

## Turn it on

The setting is per agent and is off by default. Open the agent's settings and turn on
**Local scripts**. The setting is only on the computer that runs the agent: a joined server does not
show it, and an agent cannot turn it on for itself or for a teammate.

When the setting is on, each routine of the agent has **Copy run command**. It copies a `curl`
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
  that you want such processes to wake.
