### Fixed

- Scheduled, script, and webhook routine runs that call `routine_no_update` now stop without asking the model for another answer. Test runs and reported failures still show their answers.
