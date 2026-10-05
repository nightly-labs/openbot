### Fixed

- The Stripe end-to-end check now reports the real error when it cannot start Wrangler. Before, the
  check failed with a `TypeError` about `slice` and hid the `ENOENT` error.