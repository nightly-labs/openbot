### Added

- Give one server a custom limit of active hosted sites, such as for an enterprise customer. The limit
  replaces the site limit of the server's plan, from 1 to 1000 sites. Staff set it in the account
  database.
- A commercial license gives 3 hosted sites for each user. The servers of the account with no plan
  share these sites.

### Changed

- The servers of an account with no plan and no license share 1 hosted site. Before, each server had
  1. No site is deleted: a server above the limit keeps its sites until they expire.
- An account can have at most 300 active hosted sites on its servers.
