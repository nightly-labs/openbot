### Fixed

- Moving a queued message works when more than 32 messages wait in the queue, on this computer and on a joined server. Before, every move failed with "Invalid delivery ids." or a 400 error and the order did not change.
