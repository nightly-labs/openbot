### Added

- A custom server that is ready but has no subscription opens on a full-screen offer in the desktop
  app and the web client. The offer shows the plan, its vCPU, memory and storage, personalized
  support and the monthly price. The owner subscribes with Stripe Checkout, and the server opens as
  soon as the payment is done. When the account has no billing country, the offer asks for it before
  the checkout. A consumer in the EU, the UK or Turkey first accepts that the service starts during
  the withdrawal period. A member who is not the owner sees that the owner must subscribe.

### Fixed

- The web client updates the server list when a server is added, removed or changes its plan.
  Before, it updated the list only when the page got focus again.
