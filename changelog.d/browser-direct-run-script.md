### Changed

- Agents start browser tasks sooner: the browser tools to open a page, list tabs and run a browser script are always available, so the agent no longer searches for them first.

### Fixed

- Browser scripts fail less often. An agent can choose one of several matching elements by its position, such as the second "Delete" button. Scripts also accept more ways to wait for a page, such as waiting until a loading spinner goes away, and can resolve the links that they read with `URL`.
