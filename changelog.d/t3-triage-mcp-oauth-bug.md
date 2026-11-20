### Fixed

- When an MCP server stopped accepting your sign-in, the Sign in card in the chat showed only
  Continue, and Marketplace > Apps still showed "Signed in" with only Sign out. Your agent asked you to
  sign in, but you had no way to do it. Now, when the server refuses the sign-in also after OpenBot
  renews it, OpenBot ends that sign-in. The card and the server's page show Sign in again. On a joined
  server, the server must also run this version.
- On a joined server, a member who asked an agent to add an MCP server could not sign in to it: Sign in
  said that only the person who added the server, or an admin, can change it. Now the member who asks
  for a new server is the person who added it, as when the member adds it in Marketplace > Apps. The
  server must also run this version.
