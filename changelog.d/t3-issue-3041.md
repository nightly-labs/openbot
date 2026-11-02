### Fixed

- A failed channel routing turn now writes its redacted cause, with the lead's provider and model, to `main.log` as `channel_coordination_failed`. Before, this line was missing when the channel showed "The channel lead could not route this message" or "The channel lead did not answer in time".
