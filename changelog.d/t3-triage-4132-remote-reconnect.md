### Fixed

- A server that you connect to over HTTP or HTTPS now connects again when the network comes back
  after a Wi-Fi sign-in page. Before, a sign-in page that answered in place of the server stopped
  all retries, and the server stayed disconnected until you selected Retry.
- A server that was online in the last 10 minutes now connects again within a minute after it
  comes back. Before, when its computer or network restarted, the app waited up to 5 minutes
  (15 minutes without focus) before it tried again.
