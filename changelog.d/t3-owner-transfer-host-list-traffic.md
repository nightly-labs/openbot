### Changed

- The server list now also sends the server transfers that wait for you. The app and the web app
  use them and make fewer calls to the account service. With an older account service, the apps
  use the separate call as before.
- A server that goes offline no longer makes your computer load the server list and the transfers
  again. The check for a claimed server now waits 5 s, then 10 s, 20 s and up to 60 s, and stops
  when the server shows.
- The web app loads the transfers again only when your servers change, or when you come back to
  the tab after 15 minutes or more.
