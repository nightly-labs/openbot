### Fixed

- When OpenBot cannot read Bitwarden, agents still find your saved logins from the OpenBot Vault,
  1Password and Proton Pass. Before, one password manager that could not be read stopped the
  agent from using any saved login. The Bitwarden page now also shows the problem and what to do,
  instead of only "Connected", and the agent tells you which password manager it could not read.
