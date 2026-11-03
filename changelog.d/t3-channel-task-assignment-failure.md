### Fixed

- The main log (`logs/main/main.log`) now records why a message did not start, with the redacted provider error. Before, a channel showed only "The provider could not start this assignment", and no log file kept the reason.
