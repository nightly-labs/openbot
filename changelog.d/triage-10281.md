### Fixed

- On a Mac where the Keychain refuses OpenBot, connecting an app such as Feishu failed with "System
  secret storage is unavailable." OpenBot now keeps the sign-ins and other secrets of that Mac
  encrypted with its own key, in a file that only your user can read, as it already did on Linux.
  A Keychain that works keeps the secrets as before.
