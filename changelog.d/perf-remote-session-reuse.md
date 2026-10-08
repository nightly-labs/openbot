### Changed

- Connect to a joined server faster when OpenBot starts again. The app keeps the server's remote
  session between runs, so the start asks only for a new ticket. It opens the Signal connection while
  it waits for that ticket. The kept session is encrypted, and the app forgets it at sign-out or when
  it starts with no account signed in.
- Add Settings → General → Fast connection to servers, on by default. Turn it off to end each remote
  session when OpenBot quits and to keep nothing between runs, as before.
- Write the time when the Signal connection opens to the local trace file
  (`remote-connect:signal-socket`).
