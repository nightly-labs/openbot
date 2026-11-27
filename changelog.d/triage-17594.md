### Fixed

- When you ask a ChatGPT (Codex) agent for a chart, the chat now shows the chart. Before, the agent
  sometimes used Codex's own chart skill, which works only in the Codex apps, and the chat showed
  text such as `visualize{"path":"…"}` instead of the chart. Now the agent uses the OpenBot ways to
  show a chart: a page in the chat, a diagram, a table or a text chart. Older messages keep that text.
  On a joined server, the server must also be on this version.
