### Fixed

- When an agent in Slack, Discord, Telegram or WhatsApp writes its notes and then `NO_REPLY` on the last line, OpenBot now posts nothing. Before, OpenBot posted the notes and the token in the chat, for example in a WhatsApp group from your personal number. The full text stays in the agent's chat in OpenBot. A server that answers in these apps must also be on the new version.
- A Claude agent's notes before it thinks no longer go out as part of its answer. Before, with Claude models that do not show their thinking, OpenBot joined the notes and the answer into one message, and posted it to Slack, Discord, Telegram or WhatsApp. The notes now show as thinking in the agent's chat. A server that runs the agent must also be on the new version.
