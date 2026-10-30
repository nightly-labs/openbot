### Changed

- When the connection service restarts, each app waits a random 0.5 to 4 seconds before it connects again. Before, all apps connected again in the same half second, and many of them had to try again. Open chats and connections to your servers stay up while the app waits.
