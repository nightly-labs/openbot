### Fixed

- In a Telegram group or a Discord channel, a mention with its own photo or file now gives the agent
  only that file again. Since 0.73.0, the agent also got the photos of earlier messages, also the
  photos of earlier mentions, so it could not tell which photo was new. A mention without a file
  still gives the agent a photo or voice note that a person sent just before it, but not the photo
  of an earlier mention.
