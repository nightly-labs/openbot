### Fixed

- A routine set to "Run once when OpenBot opens" now runs again after OpenBot or a provider stops
  unexpectedly during a scheduled run. Before, the run showed "Interrupted", and the routine did
  nothing until its next scheduled time, such as the next day. Now the run goes back to the queue one
  time. The agent first checks what it already did, so that it does not do an action two times. A
  routine set to "Skip this run" does not change. If your server runs OpenBot, the server must also
  be on this version.
