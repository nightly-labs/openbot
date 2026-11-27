### Changed

- The account service can answer the sign-in checks from a nearby copy of its database, and it reads the server list with fewer database calls. This helps it stay fast when many people use OpenBot at the same time.
- When a joined server disconnects, the desktop app checks your server list again after a short random wait, not at once. When many apps lose their connection at the same time, the checks do not all come at the same second.
- The web app checks your account at most once a minute when you go back to its tab.
