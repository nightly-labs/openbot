### Fixed

- Routines run again after a wake that macOS or Electron does not report. Before, an enabled
  routine stayed overdue forever after such a wake: its next run time never moved, no run started,
  and no error showed, until OpenBot restarted. A suspend that sees no resume for ten minutes now
  resumes through the same network check a reported wake uses.
