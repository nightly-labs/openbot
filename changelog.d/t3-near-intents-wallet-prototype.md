### Added

- Connect a NEAR Intents wallet in Server settings › Vault › Crypto, so agents can pay sites in crypto.
  You sign with a passkey, keep the backup and add funds. A bar shows the three setup steps. The Sign
  step lists the two browser signatures and marks each one when it is done. One signature makes the
  wallet and lets your agents pay, so setup asks for your passkey only twice. When the browser stops
  a signature, the step shows which one, and "Try again" starts it again. The daily budget starts at $25, and all
  agents, also new agents, can pay. You can change the budget and the agents on the wallet page.
  Each payment waits for your approval in the chat. Select "Always allow" to let agents pay a site up
  to a daily limit without asking. The Payments switch at the top of the wallet page stops and starts all payments. The payment card also shows in the Tasks
  view, and the agent status shows "Sending the payment…" while the payment completes.
- After you make the passkey for a NEAR Intents wallet, OpenBot tells you if the passkey has a backup.
  When the passkey is only on this device, you confirm the risk or make a new passkey. OpenBot does
  not keep a copy of your passkey. Select "Check backup" on the NEAR Intents page to check it again.
- The page that creates the passkey for a crypto wallet shows only the passkey step, with no site menu.
  It is at nearintents.openbot.run, and your password manager saves the passkey for that address.
- You do not need a NEAR Intents partner key to set up the crypto wallet. Sign in to OpenBot, and the
  setup starts at the passkey. OpenBot's account service sends the wallet calls with its own key.
- To add funds to the crypto wallet, you select a coin and a network. Each has its logo, and you can
  search the lists. USDC on Ethereum is the default, and the popular coins and networks are first.
  The deposit address shows with its QR code and a Copy button.
- Add funds shows the minimum deposit in the coin, for example "0.1 USDC".
- When the wallet service is busy, the wallet page tells you and shows "Try again".
- While you sign a wallet change, the dialog shows one Cancel button. A Cancel shows no error.
- The passkey page says "Pause payments" or "Resume payments" for these actions, and wallet errors
  say "crypto wallet".
