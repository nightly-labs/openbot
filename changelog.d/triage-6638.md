### Fixed

- A webhook routine now works with senders that use the Standard Webhooks format, such as PostHog, when you give them the routine's secret. Before, the sender refused the secret as not valid base64, and when you converted it, the routine refused each request with 401. New secrets are now in the format that these senders need. A secret that you made before still works when you convert it to base64 in the sender, or you can make a new secret in the routine editor. For a routine on a joined server, the server must also have this version.
