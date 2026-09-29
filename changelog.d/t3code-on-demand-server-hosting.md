### Added

- Add a hosted server with the plus button in the server rail. Choose a plan and pay on the Stripe
  page. OpenBot sets up the server when Stripe confirms the payment, and connects to it. Each hosted
  server is a Linux machine.
- Manage the plans of your servers. Desktop Settings has a Billing tab, and the web app has Billing in
  the account menu. It shows the plan, the storage, the price and the renewal date of each server
  that your account pays for, and a warning when a payment failed.
- Each server has a menu to change or cancel its plan, or to renew a plan that ends. Payment method
  and invoices opens the Stripe Customer Portal. You enter card details on the Stripe page, not in
  OpenBot.
- The plan of a server sets its member limit: Starter 3, Standard 10 and Pro 25 active members,
  owner included. A server with no plan keeps 3. When a plan goes down or ends, no member is
  removed, but no new member can join until there is a free seat.
- A hosted server stops 15 to 20 minutes after its last use and keeps its data. It starts again when you
  connect to it, and a few minutes before its next scheduled routine. An open app that sends no
  request or message for 1 hour does not keep the server on.

### Changed

- The account service sends product analytics events when a plan or a hosted server changes. The
  events have your account ID and fixed values only, with no email, name or server ID. See
  PRIVACY.md.

### Fixed

- Remote control connects at once to a computer or server that restarted with no clean
  disconnect. Before, it waited until the old connection timed out.
