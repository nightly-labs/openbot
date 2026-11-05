### Fixed

- The "Service unavailable" screen at start now goes away by itself when the account service answers
  again, for example when the network is ready only after the first 30 seconds. Before, you had to
  click Try again. The code on the screen now also names the failure, such as no network or a
  service error, not only `auth/unavailable`.
