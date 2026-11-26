### Fixed

- When you remove the last payment rule of the NEAR wallet, OpenBot asks you to sign once more to turn off automatic payments. Before, the wallet service still allowed payments without your signature, and the next payment ended as "Not confirmed".
- After a private crypto payment, the agent no longer tells you that it cannot confirm the payment. A private payment has no public transaction hash; this is normal.
