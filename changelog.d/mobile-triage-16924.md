### Fixed

- Show the correct reason when a Telegram chat cannot link because the computer cannot connect to the
  OpenBot service. Before, each cause showed the same "check the internet, VPN, proxy, or firewall"
  text, also when the service refused the connection or security software blocked it. The main log
  now also records why the connection failed.
