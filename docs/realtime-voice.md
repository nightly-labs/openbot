# Live voice with your ChatGPT subscription

This fork supports subscription-backed GPT-Live voice through the host's existing Codex sign-in.
The host asks Codex to refresh its selected ChatGPT account, creates the voice connection, and
keeps OAuth credentials and the control connection on the host. Clients receive an SDP answer
and an opaque local call handle. There is no automatic fallback to API billing.

GPT-Live sends agent requests through its client delegation protocol. The app submits each
request through the selected agent's normal chat queue, then sends its delivery-correlated answer
back through the host. Memory, connector permissions and tool approvals remain with the agent.
The voice model has no direct MCP or filesystem access. Its small talk and choice of when to
request help are model behavior; this port does not promise that every spoken word came from
the agent. Do not treat speech alone as proof that an action completed.

Delegated requests and agent answers remain ordinary chat messages. Each delegation carries a
bounded context handoff: available voice transcripts plus model-supplied context and agent results.
The handoff is stored separately from the visible request. Calls start with the selected agent's
name, role, instructions, essential memories and recent permitted chat, within a bounded budget.
The host also sends this startup context through GPT-Live's silent commentary channel.
The complete voice policy and selected-agent context are supplied together at creation. An explicit
instruction after the history asks for a brief, natural hello as the selected agent. History does
not become a new request. The host blocks startup delegations until the provider reports fresh user
speech, including user turns whose exact transcript is unavailable. After the hello, the call waits
for new speech. Desktop and mobile wait for the provider's session-ready event before reporting a
subscription call as connected.
Exact words are not assumed. Ending, losing or expiring a call saves a labelled context note in the
agent's existing SQLite chat. This internal note is hidden from the chat timeline. The next provider
turn receives the recent saved handoff, including when that provider session was already loaded.
Saving context does not enqueue another task or promote voice-model statements to durable facts. Empty context is marked as unavailable so the
agent asks rather than inventing it.

This mode does not keep call recordings or a second browser transcript database. Generated audio
is not proof of the exact words the user heard after an interruption.

## Host configuration

Sign into Codex with ChatGPT on the selected OpenBot host. In **Settings → Voice → Live voice calls**,
turn on **Enable live voice**. This saves on the selected host and takes effect immediately. Only
server administrators can change it; turning it off ends active calls. The phone button beside
the dictation microphone starts a call when live voice is enabled.

These host environment values provide defaults before a preference is saved:

```text
OPENBOT_REALTIME_ENABLED=1
OPENBOT_REALTIME_AUTH=subscription
OPENBOT_REALTIME_CODEX_ACCOUNT=default
OPENBOT_REALTIME_VOICE=cove
```

`default` selects the host's primary Codex sign-in. The host owner can instead set the ID of an
existing Codex provider account. A removed account, API-key login, missing subscription access or
unsupported Codex auth method fails closed. Members cannot select another host account in a call.
Codex owns refresh and account storage; OpenBot does not read or copy its auth files.

The subscription model is `gpt-live-1-codex`. Its voices include `cove`, `arbor`, `breeze`, `ember`,
`juniper`, `maple`, `sol`, `spruce` and `vale`. Access depends on the selected account and service.
The host does not infer entitlement from a successful sign-in. A real connection is the acceptance
check. The Codex token RPC is deprecated; an unsupported version shows a connection error.

For Dockge, add these settings to the existing OpenBot stack. Both the host and clients need this
fork. Upstream images and installed upstream clients do not contain this change. Changing host
environment defaults requires a restart. The saved toggle takes precedence. No production image
or installed app was changed by this source port.

Open the existing voice conversation control for the selected host and agent. Hosts without the
optional capability and phone binaries without native WebRTC keep their existing voice path.
Dictation and ordinary read-aloud settings are separate.

## Optional API billing

API voice is a separate explicit choice: set `OPENBOT_REALTIME_AUTH=api-key` and supply
`OPENBOT_REALTIME_API_KEY` through a secret/environment reference. Its optional model and voice
settings are `OPENBOT_REALTIME_MODEL` (default `gpt-realtime`) and `OPENBOT_REALTIME_VOICE`
(default `marin`). A subscription failure never selects this mode. A ChatGPT subscription does
not pay for the Platform API route. No real API call ran during source verification.

## Call lifecycle

Mute disables the microphone track. Interrupt drops the pending spoken result and silences local
playback until the next spoken input. GPT-Live owns natural turn-taking and barge-in. End releases
local media and tells the host to close its control connection. These controls do not undo or
cancel agent actions already queued; use the normal chat controls to stop an agent task.

Subscription call handles are bound to the authenticated member and selected agent. Polling and
reply operations recheck current chat access. A call without client contact expires after 30
seconds; calls also have a 15-minute lifetime. The host deduplicates delegation IDs and replies.
Handshake limits and call timers are not a provider spending guarantee.

The subscription handshake uses `chatgpt.com/backend-api/codex/realtime/calls`; the authenticated
control connection uses `wss://api.openai.com/v1/live/<call-id>`. The client exchanges media with
OpenAI over WebRTC. The existing authenticated Team connection carries SDP and delegation
requests/results. No new inbound host port is needed. API mode uses `/v1/realtime/calls` instead.

## Phone and verification

The native phone transport uses `react-native-webrtc` and its Expo config plugin. It needs a new
native app build; Expo Go or a JavaScript update cannot add the native module. SDK58/RN0.88 native
compatibility and real audio routing remain device/build acceptance gates. Input audio metering
is not implemented; the existing pulse shows spoken output.

Focused scripts write reports under `.openbot-build/`:

- `bun scripts/agent-access-e2e.ts`: real temporary host/database permissions and controlled provider I/O.
- `bun scripts/subscription-voice-e2e.ts`: real Codex stdio transport and voice service with synthetic auth and a loopback control socket.

These checks do not establish live subscriber access, audible playback or native build readiness.
For explicit live-account acceptance, `scripts/subscription-voice-live-e2e.ts` drives the named
development app with real WebRTC and two prerecorded WAV questions. It requires
`--allow-live-subscription --instance=<id> --agent=<test-agent-id> --name=<agent-name>` and two
`--audio=<question.wav>` arguments. Use a dedicated local test agent with a prior request and pass
`--history-canary=<old-response-text>` to check that startup greets without replaying it or delegating
an old task. The script opens no physical microphone. It uses the signed-in host's subscription and
saves ordinary hidden voice context on that local test agent. Its report contains verdicts and
transport metadata, without transcript text.
Before release, check two-way audio, denied permission, mute/unmute, interruption, navigation,
background, disconnect, Bluetooth and end-call cleanup on each target platform.

## Source

The browser transport adapts [CopilotKit/OpenBot947955a](https://github.com/CopilotKit/OpenBot/tree/947955a57ba600a37906462a6d267b7abb6da7fc)
with its [MIT notice](../licenses/CopilotKit-OpenBot-MIT.txt). Subscription signalling adapts
[OpenClaw6d17266](https://github.com/openclaw/openclaw/tree/6d172664c8294a9701173055c6e00b7c3ba5f798/extensions/openai)
with its [MIT notice](../licenses/OpenClaw-MIT.txt). This repository keeps its existing PolyForm
Noncommercial licence. See [OpenClaw's voice documentation](https://docs.openclaw.ai/providers/openai/voice-and-speech)
for the distinction between subscription GPT-Live and Platform Realtime.

## Mobile live-call settings

On iOS and Android, Settings → Voice shows Live voice calls for the selected server. An owner or
admin can enable or disable calls and select the voice for the next call. These are host settings,
shared by members and clients. Turning calls off ends current calls; changing the voice leaves a
current call running. The host saves the choice in `realtime-voice.json`. Old enabled-only files
remain valid, and the desktop toggle retains the selected voice.

Voice selection needs the additive `realtime-voice-selection-v1` capability (protocol 9). The
original `realtime-voice-v1` routes are unchanged. A phone connected to an older voice host can
still use its toggle, but its voice picker stays disabled until the host is updated. The host
checks the caller's current admin role and the voice list for its authentication mode. No
subscription credential or API key reaches the phone.

The iOS speech module adds `defaultToSpeaker` to WebRTC's default configuration before microphone
capture, retains Bluetooth/headset support, and restores the prior WebRTC default when the call
ends, fails or the module is destroyed. WebRTC applies the configuration and owns activation and
deactivation. The module does not take WebRTC's active audio-session lock from a synchronous JS
call; doing so can block JavaScript during cleanup while the audio unit activates. Both native platforms use the same call transport and
agent-context exchange; neither shows transcript captions.

The voice lists use the ported OpenClaw subscription profile at `6d172664c829`
(`extensions/openai/realtime-quicksilver.ts`). Subscription voices and API Realtime voices are
validated separately. Provider availability still depends on the connected account.
