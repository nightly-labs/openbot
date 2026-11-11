### Fixed

- An agent that answers Discord, Slack, Telegram or WhatsApp no longer stops for 100 minutes when it tries to send feedback to the OpenBot team. Before, it waited for the owner to approve a card in OpenBot. Nobody in the external chat could approve it, so that author's next messages got "Too many requests are waiting. Try again later." Now the agent gets the refusal at once and answers in the chat. On a joined server, the server must also have this version.
