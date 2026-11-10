### Changed

- Gemini now runs on the Antigravity CLI 1.5.4. Before, it ran on the Antigravity ACP server 1.4.5.
  Your Google sign-in stays: OpenBot copies it to the new CLI once.
- The Gemini usage ring now reads your quota from Google. Before, OpenBot asked the agent with
  `/usage`, which the new CLI does not have.
- Gemini agents show no context ring for now: the Antigravity CLI 1.5.4 does not report the context size.
