### Fixed

- When many agents reply at the same time, OpenBot uses less CPU. It saves the streamed text of all
  replies together less frequently: every 100 ms for up to 10 replies, and up to every 500 ms for 50
  replies or more. One or a few replies save and show as before.
