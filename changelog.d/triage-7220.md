### Fixed

- A channel task now shows the result of a Claude member that finishes after a long background job,
  such as an install or a dev server start. Before, the task closed when the member's turn ended, and
  the result that came after the job stayed only in the agent's own chat.
