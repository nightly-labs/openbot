### Changed

- Agents now get browser screenshots at the page size, not at the screen resolution. On a Retina
  screen, each screenshot uses about one third of the tokens. The browser panel still shows the full
  resolution.
- Large `evaluate` and `run_script` values and large GitHub tool results now reach the agent cut to a
  fixed size, with a note that tells the agent how to get the rest. Before, each large result stayed in
  the conversation and made each later turn cost more.
- When an `evaluate` or `run_script` value is larger than 64 KB, the error now tells the agent how to
  get the value in smaller parts. Before, the agent often stopped at this error.

### Fixed

- On a Retina screen, a click at a point that an agent read from a browser screenshot now hits that
  point. Before, the click went to a point at twice the distance.
