### Added

- Use the host's ChatGPT subscription for live agent voice. Requests use the normal agent chat,
  memory and tools. API billing is a separate explicit choice, with no automatic fallback.

### Fixed

- Keep saved voice context available to the agent without showing the internal handoff as a chat message.

- Add a saved live voice toggle in Voice settings and a phone button beside dictation.
- Give live voice the selected agent's identity and recent context, and keep delegation handoffs out of visible requests.

- Match voice replies to queue delivery IDs, including replies that finish before send acknowledgement.
- Keep selected-agent context on the silent control channel.
- Seed the live voice identity at call creation so it introduces itself as the selected agent.
- Remove transcript text from the call panel while retaining internal conversation context.

- Wake a sleeping Codex provider before starting subscription voice.

- Save the selected live-call voice on the host and expose an optional voice-selection route to mobile clients.
- Greet as the selected agent when a call starts, without treating historical messages as new requests.
- Keep the full agent policy in the creation context and wait for provider readiness before accepting speech.
