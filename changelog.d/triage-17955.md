### Fixed

- An agent that opens a page that shows a dialog while it loads, for example "Sign in again?", now
  gets the dialog at once and can answer it. Before, the open step waited until somebody closed the
  tab, and a scheduled routine stayed "still running" for hours. An open step on a page that does
  not stop loading now also ends at its time limit.
