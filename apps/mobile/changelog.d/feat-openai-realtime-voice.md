### Added

- Add a private Android voice build that installs beside the official app.

- Use the host's ChatGPT subscription for live agent voice. Requests keep the normal agent chat,
  memory and tools. This needs a native app build with WebRTC.

### Fixed

- Match pending live voice replies to the delivery ID returned by the host.

- Hide speech transcripts from the live call bar while retaining call status and errors.

- Use Android call audio on the speaker or a connected headset, with call volume controls and routing cleanup.

- Add server live-call settings on iOS and Android, with an admin toggle and a saved voice choice.
- Use the iOS speaker by default, preserve connected headset routing, and restore the audio configuration after calls.
- Refresh live-call availability after returning from settings or reconnecting.

- Keep iOS live-call cleanup responsive while WebRTC activates its audio unit.
- Wait for subscription voice readiness before showing a connected call.
