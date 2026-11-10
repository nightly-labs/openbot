### Fixed

- Work that an agent started on a backup account or model now continues on its own account or model
  when that limit has ended. Before, when the backup also reached its usage limit and no other backup
  was ready, the message failed with "You've hit your limit", the agent switched back, and you had to
  ask it again.
