### Changed

- Use less memory for agent browser tabs. Only the 3 most recently used idle tabs stay loaded; an
  older idle tab unloads its page after 2 minutes and loads it again on its next use. An idle tab
  now unloads after 15 minutes, not 30. Before, each open tab kept about 300 MB until it was idle
  for 30 minutes.
- A browser preview card no longer loads an unloaded tab again when the tab has no saved preview.
- Keep fewer chat images in memory: the image cache is now 16 MB of text, not 64 MB.
- Daily resource analytics now show the JavaScript heap, page object heap, ArrayBuffer memory and
  DOM node count of the app windows, and on Windows the private memory of each process group.
- Idle Claude, ACP (such as OpenCode) and Pi threads now stop their processes after 5 minutes, not
  10, and only one idle thread keeps its process. Its next message resumes the session.
- On a server that is low on memory, a Claude thread whose background tasks sent nothing for 30
  minutes now closes.
- Codex agents now free the memory of idle conversations: OpenBot unloads a Codex session 5
  minutes after its last turn, and keeps only the newest idle session of each Codex process loaded.
  It does not unload a session that runs a background terminal or waits for an approval or an
  answer. The next message resumes the same conversation.
- The app window keeps the messages of only the 5 most recently opened hidden side threads in
  memory. An older side thread loads its messages again when you open it.
- A browser preview card asks for a new picture every 3 seconds while the agent works, and every 20
  seconds when the agent is idle.
- Streamed reply text now updates the chat once per frame, not once per received part.
- The Markdown cache of chat messages now keeps at most about 2 million characters, so long
  pasted logs do not stay in memory after you close their chat.
- Played voice replies keep their audio for 3 minutes. A later replay makes the speech again.
- A live browser view that is not on screen stops receiving frames.
- When OpenBot stops Claude Code, Codex or Pi, it now also stops the processes that their MCP
  servers started. Before, a child of an MCP server could continue to run, and use memory, after Claude Code
  stopped.
- Each app window now loads only English and the language it shows, not all 15 languages. This
  uses about 30 MB less JavaScript memory in the main window and in each helper window.
- Claude Code errors show the end of the CLI's error output again when the CLI stops with an error.
