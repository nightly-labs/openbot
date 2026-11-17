### Fixed

- WhatsApp: Add contact now refuses a number that has no WhatsApp account, such as a number typed
  without its country code. Before, OpenBot saved the contact and reported its messages as sent, but
  the person did not get them. The error tells you to type the number with its country code. When the
  number is not connected or WhatsApp does not answer, the contact is saved as before. A contact that
  you added before stays; remove it and add it again with the country code. For a joined server, the
  server must also be on the new version.
