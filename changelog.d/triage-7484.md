### Fixed

- An agent can now sign in with a saved password on a site that asks a question before it continues,
  such as "logged in on another device". Before, OpenBot emptied the password field after the first
  "Sign in", so the site then showed "Password cannot be blank". The password now stays in its
  field, hidden from the agent, until the page changes.
