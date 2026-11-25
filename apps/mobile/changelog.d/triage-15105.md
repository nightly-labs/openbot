### Fixed

- When an agent does some steps and then ends its turn with no answer, the chat now shows a note:
  "<provider> did some steps, then ended the turn with no answer. Ask the agent what it did before
  you send the same request again." Before, the phone showed an empty reply with no reason. The
  server must also be on the new version.
