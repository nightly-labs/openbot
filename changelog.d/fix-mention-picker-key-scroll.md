### Fixed

- The composer's @ and $ pickers kept the arrow-key highlight when the list scrolled a row
  under a stationary pointer. Chromium fires `mouseenter` for the row that passes beneath the
  cursor without a real pointer move, which used to steal the highlight and make the top of
  the list unreachable. Hover selection resumes on the next actual pointer move.
