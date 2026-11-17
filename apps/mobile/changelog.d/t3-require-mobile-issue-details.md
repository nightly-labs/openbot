### Added

- Send a bug report about the phone app with the data that the OpenBot team needs. When an agent offers such a report, the card shows what the phone adds: the app version, your system and device, your kind of network with the name of the VPN or mesh network that is on (such as Tailscale), and the last warnings, errors and connection events of the support log. The log lines have no server ID, network address, host name of your server or record ID: the app masks them, and it leaves out console lines. Before, the report had only the data of the computer or server. The server must run the newest OpenBot version.

### Changed

- The support log now also has the screens that you open (by name only), each step of the notification setup, the notification, microphone and camera permissions, the free storage range and low memory warnings. This helps the OpenBot team find the cause of a problem such as missing notifications.

- "Report a problem on GitHub" in Settings > Support opens the form for the phone app with your app version and device filled in.
