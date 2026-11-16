### Fixed

- Usage shows the input tokens and the cost of each Gemini turn that reads cached context. Before,
  these turns had no input count and no cost, so the Gemini totals were too low (#10010). Turns that
  are already saved do not change. For agents on a joined server, the server must also be on the new
  version.
