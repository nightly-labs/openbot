### Fixed

- When you connect GitHub in Marketplace > Apps > GitHub, agents can still use git on the private
  repositories that your own git or GitHub CLI login reaches, also when the OpenBot GitHub App is not
  installed on them. Before, git fetch and push on these repositories stopped with an error. On
  repositories where the app is installed, agents still act as `openbotgit[bot]`. On a server, the
  server must also be on this version.
