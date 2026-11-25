### Fixed

- When an agent does some steps and then ends its turn with no answer, the chat now keeps a note
  under your message: "<provider> did some steps, then ended the turn with no answer. Ask the agent
  what it did before you send the same request again." Before, the chat showed an empty reply, and
  the reason was only in a banner above the message box that went away when you started to type.
  For an agent on a server, the server must also be on the new version.
