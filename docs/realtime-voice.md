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

Delegated requests and agent answers remain ordinary chat messages. On the phone that made a
voice call, they appear under a collapsed **Voice call** row. **View details** restores the
original messages. Questions, approvals, failures and unrelated typed messages stay visible; search
opens matching call details. The phone keeps bounded encrypted local call and delivery IDs, without
text or audio, scoped to its signed-in account. Sign-out removes those IDs. Other clients keep
the normal chat view.

A handoff can include a brief spoken acknowledgement. The microphone keeps listening while the
main agent works. A completed spoken acknowledgement does not discard its pending agent answer;
that delivery-correlated answer returns to the same call. Another tool request is not accepted
while the first one is pending. Explicit interruption and end retain their normal behavior.

Each delegation carries a
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
agent's existing SQLite chat. The host leaves this internal note out of client history, live events,
reply references, message search and unread counts, including responses to released clients that do
not recognize voice context. Desktop and web also omit cached notes by their item type. Ordinary
typed quotations remain visible; their text is not used to identify internal notes. The next provider
turn receives the recent saved handoff, including when that provider session was already loaded.
Saving context does not enqueue another task or promote voice-model statements to durable facts. Empty context is marked as unavailable so the
agent asks rather than inventing it.

Live-call controls and voice settings are implemented in the desktop and custom native mobile
clients. The browser workspace does not provide live calls or a voice picker. Its chat still gets
the same filtered history. A host update can hide internal context from an older released desktop
client without adding live-call controls to that client.

This mode does not keep call recordings or a second browser transcript database. Generated audio
is not proof of the exact words the user heard after an interruption.

## Host configuration

Sign into Codex with ChatGPT on the selected OpenBot host. Use **Server settings → General → Live voice calls** to allow calls and select the shared default voice. Only server owners and admins see these host controls. Then each user can enable **Use ChatGPT voice on this device** in **Settings → Voice**. This account-and-device choice starts off and never changes another user or device. The notice states that agent calls send microphone audio and conversation context to OpenAI. Without this choice, the existing voice conversation uses the local recognizer and reply voice, with captions. Channels keep that local path. On desktop, the telephone button beside dictation appears after device opt-in and host availability. On mobile, the empty composer’s voice control starts the call. Before starting, its visible label identifies ChatGPT voice or the existing device voice settings; ChatGPT calls use a telephone glyph.

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

On iOS and Android, **Settings → Voice** has the personal **Use ChatGPT voice on this device** switch. It starts off for each account and device. Turning it on does not enable a host or change another member's settings. The existing local voice path remains available when it is off, including captions.

Owners and admins use **Server settings → General → Live voice calls** for host availability and the shared default voice. Members do not see these host controls. Agent settings retain the per-agent voice override. Changing a voice affects the next call. Host availability is separate from device consent; a host cannot opt in a client. The existing capability-gated wire routes and their authorization rules remain unchanged.

The iOS speech module adds `defaultToSpeaker` to WebRTC's default configuration before microphone
capture, retains Bluetooth/headset support, and restores the prior WebRTC default when the call
ends, fails or the module is destroyed. WebRTC applies the configuration and owns activation and
deactivation. The module does not take WebRTC's active audio-session lock from a synchronous JS
call; doing so can block JavaScript during cleanup while the audio unit activates. Both native platforms use the same call transport and
agent-context exchange; realtime calls hide transcript captions, while local voice conversations retain them.

The voice lists use the ported OpenClaw subscription profile at `6d172664c829`
(`extensions/openai/realtime-quicksilver.ts`). Subscription voices and API Realtime voices are
validated separately. Provider availability still depends on the connected account.

## Agent voices and the server default

Voice settings remain visible when the host is not ready. The disabled device switch explains the requirement and links to Codex setup and server availability. The Codex provider page links back to this entry point. Agent settings also link to Voice call setup. Reading these
settings does not start a sign-in or request a subscription token. The host reports only this
availability flag, not provider credentials or account details. A connected provider does not
establish upstream voice entitlement; the existing authenticated call handshake still checks it.

The picker in Server settings is the server default. Agent settings provide an independent voice or
**Use server default**. Resetting an agent removes its override and follows later default changes.
A different chat provider does not change the agent's voice. Choices apply to the next call and do
not interrupt an active call. The host saves the default and agent-ID map together in the existing
version-1 `realtime-voice.json`; enabled-only and default-only files remain valid. No SQLite schema
or provider assignment changes. Back up the host preferences with the rest of its data.

The additive protocol-9 `realtime-voice-agent-settings-v1` capability carries configuration reads
and selections. Current chat access is required to read an agent choice; manage access is required
to change it. Connector access restrictions remain part of that check. Only server owners/admins
can change the default. Older wire routes retain their prior meaning and changing the legacy
default does not erase agent overrides. Unsupported hosts keep the switch disabled and show the update requirement.

## Voice setup entry point

Start at **Settings → Voice → Live voice calls** on desktop or mobile. The device switch stays
visible when setup is incomplete. Its reason distinguishes an offline or old host, a failed
availability read, Codex sign-in requirements, and server call availability. Turning the device
choice off remains possible when the host is unavailable.

Use **Set up Codex** to open the provider page, and **Server availability and default voice**
to open the host controls. The Codex page reports readiness and the ChatGPT subscription
requirement and links back to Voice call setup. Agent voice settings also link back here; an
agent override remains a host setting, while the opt-in remains account-and-device specific.

On the phone, server admins can download or update Codex, turn a disabled Codex provider on,
and sign in through a device code or the browser relay. The browser flow supports a returned
loopback address pasted back into the app. Opening setup does not start OAuth. A sign-in starts
only after the user selects it. Members get the requirement and an instruction to ask an admin.
The provider enable action is a new protocol-9 `realtime-voice-setup-v1` capability. It requires
current server admin access, enables only Codex through the existing provider operation, and
neither selects a chat provider for an agent nor opts any device into cloud audio.

The mobile empty-composer control shows its audio path before starting. **Start ChatGPT voice
call** uses a telephone glyph; **Start voice conversation with device voice settings** keeps
the existing audio glyph. Dictation remains a separate microphone control. Desktop retains its
telephone button beside dictation. Channels retain the existing device voice path.
