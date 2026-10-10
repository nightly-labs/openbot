### Fixed

- Keep inputs whose provider acceptance is unknown after a steer or turn-start timeout, transport failure, or invalid response. Do not resend them automatically or treat the target turn’s completion as acceptance of a pending steer. Show the pending input in the queue with a delivery warning and a local cancellation action. Confirm delivery only from a matching request receipt or an exact provider input identity; keep definite pre-submission steer refusals at their original queue position.
