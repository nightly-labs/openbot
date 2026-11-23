### Fixed

- A Kimi model whose thinking is only on or off, such as K3.1 Pro Highspeed, now thinks by default,
  and **Effort** shows **High** next to **None**. Before, OpenBot offered only **None** and turned
  thinking off at each message, so a model that must think refused each message with "does not
  support disabled thinking mode". An agent that already uses such a model keeps **None**: select
  **High** in **Effort**. On a joined server, the server must also be on this version.
