### Fixed

- Gemini (Antigravity) agents keep the tool search, so they can find and use the browser file upload
  and other OpenBot tools when Computer Use or many MCP tools are on. Before, the Gemini CLI could leave
  out the tool search, and the agent said that it had no upload tool. On a joined server, the server
  must also be on this version.
