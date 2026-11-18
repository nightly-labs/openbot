### Fixed

- When Google must verify the account of a Gemini agent, the error in the chat shows the **Verify
  account** button again with the Antigravity CLI 1.5.6 and later. Before, the button did not show
  when the CLI wrote Google's verification link before the message or in another log of the account,
  and the user had to find the link on the disk. For an agent on a joined server, the server must also
  be on the new version.
