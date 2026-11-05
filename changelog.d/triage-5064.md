### Fixed

- Devin and other agents that write Rust log records no longer show an info or warning record as
  a provider error. Before, a record such as `INFO … request failed, will retry` from Devin CLI
  showed as an error and wrote "A provider failed." to the log. Error records still show.
