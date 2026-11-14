### Fixed

- When Claude's service blocks a request for a short time, a Claude agent now says so in plain words
  and tells you to send the message again in a few minutes. Before, the chat showed "Failed to
  authenticate. API Error: 403 Attention Required! | Cloudflare", as if your Claude sign-in had a
  problem. An agent that has backup models still moves the request to its next backup model.
