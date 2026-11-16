### Fixed

- An OpenCode chat whose history has an image that OpenCode cannot send again now continues in a new
  session with the chat history. Before, each later message failed at once with "Media strings must
  be base64", and a channel showed the same failure again and again.
