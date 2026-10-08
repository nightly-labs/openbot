### Fixed

- Grok chats keep their message order after a reload and when you load older messages. Before, a message that you sent while Grok worked could show above Grok's answer to the message before it.
- A message that you send to a running turn now shows after what the agent did before it. Before, it moved up to the turn's first message.
- Grok's thinking after a tool call shows as its own step. Before, it joined the thinking from before the tool call.
- When you read a chat through an event that came while the agent worked, the agent's answer above it is read too. Before, it stayed unread.
