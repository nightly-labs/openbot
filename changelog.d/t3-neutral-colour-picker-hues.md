### Added

- Add lime and indigo to the agent colors. Agents that had lime show lime again, not green, and
  agents that had indigo show indigo, not violet.
- Agents can use more colors: sky blue, navy, pink, wine, brown, sand and gray. An agent keeps its
  exact color, and a joined server or the web client shows it when the server has the new optional
  `agent-colors-v1` capability. Older apps and servers show the nearest released color.

### Fixed

- In the new agent setup, you can click every color. Before, the large avatar covered the colors in
  the middle of the row, so a click there did nothing.
