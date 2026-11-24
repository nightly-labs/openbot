### Fixed

- Steer a message that you send while the agent starts its turn. Before, the message waited until the
  whole turn was done.
- Steer a message into an Antigravity or Devin turn before the agent writes its first update. Before,
  the steer failed and the message waited until the whole turn was done.
- Steer messages again after a Stop that did not stop the turn. Before, each next steer failed.
