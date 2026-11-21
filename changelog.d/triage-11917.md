### Fixed

- When an account publishes or replaces sites too many times, the error now says which limit stopped it and
  when to try again. Before, a replace showed only "The publish limit for this account was reached.", while
  the site list showed free sites. Agents then tried again each few seconds, and the site looked blocked
  with no way out. Now the error says "20 site publishes and replaces in one hour" (or "100 in one day"),
  says that this is not the limit on the number of sites, and gives the wait, for example "Try again in about
  10 minutes". The answer also has a `Retry-After` header. This change is in the account service, so it
  also works with older versions of the app.
