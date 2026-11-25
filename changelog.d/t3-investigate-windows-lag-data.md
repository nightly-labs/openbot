### Fixed

- The app freezes less often, mostly on Windows. Before, the app checked each agent program again at
  each start, looked up the same programs many times, and did some saves and file checks while the
  window waited. Now it keeps the results of these checks for a short time and does the slow work in
  the background.
- Long replies from agents save faster while they stream. Before, each streamed part changed more
  data than necessary, and some routine checks searched more rows than necessary.
- On Windows, the app freezes less when an agent that uses Claude Code starts a reply. Before, the
  main process of the app started the Claude Code program and waited for Windows. Now a separate
  background process starts it. If that process cannot start, the app starts Claude Code as before.
