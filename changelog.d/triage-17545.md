### Fixed

- On a Mac, when the Keychain does not give OpenBot its key, the Vault page no longer says that OpenBot cannot decrypt the Vault, and it no longer offers only Reset Vault. The page now tells you to unlock or set up the secret storage and to open OpenBot again, and OpenBot keeps your Vault items. A reset is refused while the Vault waits for the Keychain. The Vault opens again when the Keychain gives the key.
