### Fixed

- Treat a message from the OpenBot user's own WhatsApp account as the OpenBot user in every chat, not
  only in "Message yourself". A message that the owner writes in their own group, or in a direct chat
  with a person they linked, no longer reaches the agent framed as a stranger asking for private data,
  which made the agent refuse requests that were the owner's own.