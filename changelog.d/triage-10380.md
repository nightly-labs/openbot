### Fixed

- An agent can now find a request that it sent to a teammate, for example from a routine. Before, a
  search of its history did not find the request, and a read by the request's Message ID failed with
  "History is unavailable for this request" for the sender and the teammate. An unknown message ID
  now gets an error that tells the agent what to send instead. On a joined server, the server must
  also be on the new version.
