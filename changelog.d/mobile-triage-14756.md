### Fixed

- When the page of a browser tab crashes while an agent uses the tab, the agent now learns about the
  crash at once and can continue. Before, the agent could stay on "Thinking..." until you stopped it,
  and its routines and queued messages waited too. For an agent on a joined server, the server must
  also be on the new version.
