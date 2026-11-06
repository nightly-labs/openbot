### Fixed

- Scheduled, script, and webhook routine runs that call `routine_no_update` now stop without another model answer, also when the provider keeps sending empty reasoning. Test runs, reported failures, and a user stop keep their own results.
