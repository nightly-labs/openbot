### Fixed

- Fill a Bitwarden login on every page of its site when the login uses the default or "Base domain"
  match rule, as Bitwarden does. A login saved for `myaccount.google.com` now also fills on
  `accounts.google.com`, and a saved address with no `https://` now fills. Before, OpenBot found the
  login only on the same address, so the agent asked for the password and the code again at each step.
