### Fixed

- Start the Umbrel app on umbrelOS hosts where AppArmor 4 blocks user namespaces, such as umbrelOS 2.0 on Debian 13. Before, the container stopped in a restart loop because Docker's `docker-default` AppArmor profile denied `userns_create` (#14843).
