### Changed

- Streamed replies use less CPU. The app parses the reply text less often and changes only the message fields that changed.
- Workflows that run at the same time stay responsive. The canvas updates only the steps that changed, the step timers share one clock, and the app merges refresh requests.
- A server sends updates to its joined clients with less CPU.
