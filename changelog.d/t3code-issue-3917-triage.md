### Fixed

- Saved logins from the Vault, 1Password, and Bitwarden now fill the password on sign-in pages whose
  form has no `method`, such as Clerk sign-in pages. Before, the password card opened each time.
  OpenBot still stops the browser from putting a filled password in a page address.
- When OpenBot does not fill a saved login, the agent now gets the reason, and the log shows it.
  Before, the password card opened with no reason.
