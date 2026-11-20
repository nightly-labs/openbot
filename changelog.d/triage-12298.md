### Fixed

- A Gemini agent whose message ran without OpenBot's tools now shows that the message failed, with a
  plain reason and "Try again". Before, the turn showed as done while the agent could not message its
  teammates, use the browser or attach files, and a routine run with this problem showed as a success.
  This needs Gemini CLI 1.5.11 or later. On a joined server, the server must also be on the new
  version.
