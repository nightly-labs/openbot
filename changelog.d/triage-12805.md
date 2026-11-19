### Fixed

- When OpenBot was closed at the time of a routine and the routine skipped that run, the agent said
  that the routine had no runs. Now the agent sees the skipped run and can tell you that OpenBot was
  closed at the scheduled time. It also sees runs that were skipped because of a usage limit or
  because the last run had not finished.
