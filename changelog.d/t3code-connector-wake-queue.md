### Added

- A mention, a direct message, a thread reply or a button press in Slack, Discord or Telegram starts
  a hosted server that sleeps. Signal keeps that message, encrypted for the server, for up to
  10 minutes, and the server answers it when it starts.

### Changed

- A hosted server with a Slack, Discord or Telegram connection now sleeps after 15 minutes with no use,
  as other hosted servers do. Before, a live connection kept it on all the time.
