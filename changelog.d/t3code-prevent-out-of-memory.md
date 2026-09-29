### Fixed

- On a new hosted server, OpenBot keeps running when the server is out of memory. Before, the system could stop OpenBot, or stop all of OpenBot when one agent process used too much memory. Now an agent process stops first.

### Changed

- When a hosted server is low on memory, new messages wait in the queue and start when memory is free. The agent shows a notice, and the browser opens no new tab.
- A hosted server runs at most 4, 8 or 16 agent turns at the same time, from the memory of its plan. Other messages wait in the queue, and a message from a person starts before routine runs and teammate messages.
