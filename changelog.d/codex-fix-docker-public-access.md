### Fixed

- Docker releases now check that image tags are readable without a GHCR sign-in. Previously, a release could pass while the package was private.

### Added

- Docker version tags now also accept the `v` prefix used by GitHub releases.
