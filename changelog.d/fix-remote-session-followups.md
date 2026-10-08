### Fixed

- A remote connect that fails before its ticket now closes the Signal socket that it opened early,
  instead of keeping it open for 30 seconds.
- Turning on Settings → General → Fast connection to servers during a run now also keeps the
  sessions that are open at that time. Before, these sessions ended when you quit the app.
