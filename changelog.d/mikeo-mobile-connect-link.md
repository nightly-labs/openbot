### Changed

- `openbot mobile-connect` on a Docker or self-hosted server now also prints the Mobile Connect link
  under the QR code. On a phone that shows the terminal, tap the link (or, on an iPhone, copy it into Safari) to
  open it in the OpenBot app. Before, only a QR code was shown, which that phone cannot scan.
- After `openbot login`, the server says that you can sign in to the phone app with the same email
  to see the server there, with no QR code.
