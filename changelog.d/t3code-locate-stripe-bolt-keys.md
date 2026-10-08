### Changed

- Development commands can start without shared secrets and load the encrypted shared development settings when the developer has the development key.
- Local development identity and overrides persist in ignored state, and the APNs helper writes to that state.
- Stage one accepts `DOTENV_PRIVATE_KEY_DEV` and the legacy `DOTENV_PRIVATE_KEY_SHARED` name for the existing `.env.shared` file.
- Development commands keep account and decryption secrets out of browser and tunnel processes, and secret-dependent E2E commands check required keys before changing test data.
