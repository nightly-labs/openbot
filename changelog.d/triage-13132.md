### Fixed

- In the Marketplace, an app that needs no sign-in and no key, such as Apple apps, now shows
  "Connected" only after its server starts and answers. When the server does not start, OpenBot
  does not add the app and tells you why, for example "Could not connect Apple apps: The server
  stopped before it answered", and you can click Connect again. Before, the app showed "Connected"
  also when its server could not start, and agents then could not use its tools.
