### Fixed

- On Windows, an OpenCode agent could not delete another agent: `delete_agent` failed each time, and
  the agent stayed in the list. The agent that asked for the delete was still answering, so OpenBot
  kept the shared OpenCode process, and that process kept the folder in use. The same happened from
  the sidebar while another OpenCode agent worked. OpenBot now deletes the agent by itself when that
  work ends, and the message says so. If you quit OpenBot before then, delete the agent again. For
  an agent on a joined server, the server must also be on this version.
