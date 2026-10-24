### Fixed

- Restart now closes turn rows that stayed `running` although no thread names them as its active turn. Before, such rows stayed `running` for good, as the follow-up data on #2214 showed.
