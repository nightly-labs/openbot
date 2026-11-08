### Fixed

- When a network proxy stops a Gemini (Antigravity) reply with an HTTP error, such as
  "HTTP/1.0 502 Bad Gateway", the chat now says that the service did not complete the request and
  that you can try again. A proxy's 429 error now shows the rate limit message. Before, the chat
  showed only the raw error text.
