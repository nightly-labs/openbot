### Fixed

- Gemini agents answer again on the second and later messages of a chat when an MCP server has a tool
  that Gemini cannot read, such as `get-contact` of Resend. Before, only the first message worked, and
  each later message failed with "agent executor error: building toolbox". On a joined server, the
  server must also be on this version.
