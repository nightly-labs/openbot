### Fixed

- A long ChatGPT chat no longer waits up to 20 minutes with only "Compacting context" when ChatGPT loses its connection during a compaction that OpenBot started. Before, the app did not say that ChatGPT tried again, and new messages in that chat waited without a reason. Now a notice says that the compaction failed and tries again, and OpenBot stops the compaction after at most 10 minutes of tries, so the waiting messages go to the agent. The notices when a compaction fails or takes too long now use plain words in your language. The server must also be on the new version.
