### Fixed

- A cancelled or unfinished Stripe payment no longer blocks a new hosted server. A new plan choice now changes the plan of the server that waits for its first payment, and does not add a second server.

### Changed

- When an account has the maximum number of paid hosted servers, the add server dialog now tells the user before they choose a plan. The plans are disabled, and a "Manage servers" button opens the list of hosted servers, where the user can delete one.
