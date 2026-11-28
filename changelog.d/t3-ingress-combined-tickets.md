### Fixed

- Connect Slack, Discord, Telegram and webhooks to Signal with one request to the account service.
  Before, each connection made one request for each route, and a restart of Signal made a large
  number of requests at the same time.
- Add a route that was missing at the start on the open Signal connection. Before, OpenBot closed
  the connection and connected again to add the route.
- Stop asking for the Telegram route again when the account service has no Telegram setup. Before,
  OpenBot connected to Signal again about every 5 minutes.
