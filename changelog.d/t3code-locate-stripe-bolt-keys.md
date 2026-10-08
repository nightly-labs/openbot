### Changed

- Development commands can start without shared secrets and load the encrypted shared development settings when the developer has the development key.
- Local development identity and overrides persist in ignored state, and the APNs helper writes to that state.
- Encrypted development settings use `.env.dev` and the shell key `DOTENV_PRIVATE_KEY_DEV`; production settings remain unchanged.
- The update resets old generated `.env.dev` settings. Existing identity keys and overrides in `.openbot/dev-state.json` remain unchanged.
- Development commands keep account and decryption secrets out of browser and tunnel processes, and secret-dependent E2E commands check required keys before changing test data.
