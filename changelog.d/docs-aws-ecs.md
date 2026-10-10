### Added

- Added a guide to run the Docker image as an AWS ECS service on EC2, with the seccomp profile, the
  data volume, ECS Exec sign-in and CloudWatch logs. AWS Fargate is not supported: it cannot keep
  the Electron sandbox on. See `docs/aws-ecs.md`.

### Changed

- The Docker image now works when `/dev/shm` is smaller than 1 GiB, for example on Kubernetes:
  Chromium then keeps its shared memory in `/tmp`. Before, Chromium could run out of shared memory.
