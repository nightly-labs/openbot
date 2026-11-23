### Fixed

- The Docker guide now lists `OPENBOT_HERMES_PATH` and `OPENBOT_REMOTE_SIGNAL_URL`, shows how to get `compose.yaml` and `seccomp.json` of a pinned release, and checks that the image attestation comes from the release workflow of that tag. Before, the guide did not list the two variables, always got the files from `main`, and accepted an attestation from any workflow of the repository.
