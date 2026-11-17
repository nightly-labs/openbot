### Changed

- Turn off "Delete channel" while an agent works in the channel. Stop the work first, then delete the
  channel. Before, the delete stopped the work, but until the provider ended the turn, the agent's
  other chats said "Waiting - <agent> is working in <channel>" and named the deleted channel. On a
  joined server, the server must also be on this version to stop that message.
