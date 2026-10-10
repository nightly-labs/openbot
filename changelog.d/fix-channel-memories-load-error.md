### Fixed

- The channel settings rows for Memories and Routines no longer read `0 saved` and `0 configured`
  when the host refuses the count. A count that could not be read now shows no count, and the
  failure is reported, instead of raising an unhandled error in the window.
