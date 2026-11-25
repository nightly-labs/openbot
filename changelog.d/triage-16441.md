### Fixed

- GitHub: when a GitHub organization uses single sign-on (SAML) and refuses the GitHub sign-in of
  OpenBot, the agent now tells you how to fix it: open the single sign-on page of the organization,
  then disconnect and connect GitHub again in the same browser. Before, the agent showed only the
  GitHub error, which told you to grant access to a token.
