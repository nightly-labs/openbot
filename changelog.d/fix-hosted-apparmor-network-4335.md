### Fixed

- Hosted servers on Ubuntu 24.04 keep network access after an update loads the `openbot-hosted`
  AppArmor profile. Before, the profile had no `network,` rule, so socket creation failed with
  `EACCES` after `openbot.service` restarted (#4335).
