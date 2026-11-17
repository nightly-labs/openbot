### Fixed

- In a Telegram group, the agent now gets a voice note, a photo or a file that a person sent without
  a mention. When somebody mentions OpenBot in a new message, the agent gets the messages and files
  of the 15 minutes before it. When somebody replies to a voice note and mentions OpenBot, the agent
  gets that voice note. Before, the agent saw an empty message and no file. When a joined server
  receives the Telegram chat, that server must also be on the new version.
