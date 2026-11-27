### Fixed

- A ChatGPT (Codex) agent now shows a chart that you ask for as a page in the chat. Before, the agent
  sometimes used Codex's own chart skill, which works only in the Codex apps, and the chat showed text
  such as `visualize{"path":"…"}` instead of the chart. Older messages keep that text. On a joined
  server, the server must also be on this version.
