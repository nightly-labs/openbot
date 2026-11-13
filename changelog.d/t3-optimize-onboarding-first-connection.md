### Changed

- The app opens as signed in from the saved session and confirms the session in the background. Before, the
  start waited for the account service to answer.
- A joined server loads its workspace one time when the app connects. Before, the app loaded all the data
  two times, which sent about twice the requests to the server.
