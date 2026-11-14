### Fixed

- When OpenBot cannot read Bitwarden, agents still see your saved logins from the OpenBot Vault,
  1Password and Proton Pass, and they tell you that Bitwarden could not be read. Before, one
  password manager that could not be read hid all saved logins from the agent, with no reason. The
  Bitwarden page now also shows the problem and what to do, next to "Connected". On a server,
  OpenBot unlocks Bitwarden again at the next sign-in.
