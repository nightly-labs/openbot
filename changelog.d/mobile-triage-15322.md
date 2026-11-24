### Fixed

- Send a phone notification when a workflow reaches a "Notification" output or a step that waits for
  approval. Before, the notification showed only on the computer that runs OpenBot, so on a server
  nobody got it, but the step still showed "done". Output notifications go to people whose
  notification level is "All", and approval requests also to people on "Needs me". The server must
  also be on this version.
