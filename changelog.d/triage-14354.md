### Fixed

- A custom agent now answers again in the same chat after a reply that stopped or timed out. Before, some agents kept that chat open in their own process and refused it, so each new message failed with "session is already active" until you quit OpenBot or started a new chat. OpenBot now closes the chat in the agent and opens it again. When the agent cannot close it, OpenBot keeps using it. While the stopped reply still runs, your message waits in the message queue and starts when the agent is free.
