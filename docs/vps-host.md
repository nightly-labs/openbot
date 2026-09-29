# OpenBot on a Linux VPS

OpenBot has no server build. The host is still the desktop app. On a VPS that means the Linux
AppImage, a virtual display, and this process left running. Clients connect from another computer,
the mobile app, or the browser client at `/app`. Chats and files stay on the VPS. The host does
not need a public inbound port.

Voice prompts and remote desktop stay unavailable on Linux. Computer Use and the embedded
browser need a real session and are not reliable under Xvfb. This does not add a per-agent desktop.

## What the process needs

- An x64 or arm64 Linux VPS with about 4 GB of RAM. Electron plus a provider CLI does not fit
  comfortably in 2 GB once an agent is working.
- The release AppImage, not a source checkout, unless you are developing.
- `xvfb` and, on Ubuntu 23.10+ or Debian 13, the AppArmor profile from `build/linux/openbot.apparmor`.
  Do not start the app with `--no-sandbox`.
- A dedicated user. Agents run with full local access after the first-launch consent. Do not run
  this as root, and do not keep unrelated secrets in that home directory.
- Outbound network access to the account API, Signal, and the provider you sign in.

`OPENBOT_HEADLESS=1` hides the main window and stops a window close from quitting the process.
The launcher is `scripts/openbot-vps.sh`. Copy it to `~/.local/bin/openbot-vps`. It starts Xvfb
only when no display is set. Do not pass Chromium's `--headless` switch to the AppImage. The
OpenBot switch, if you need one on a command line, is `--openbot-headless`. An explicit
`OPENBOT_HEADLESS=0` wins over that switch.

## First setup

Headless mode cannot click through consent, provider login, or publishing. Do that once on a
display you can see, then switch the service to headless.

1. Copy the AppImage to `~/OpenBot.AppImage` and `chmod +x` it.
2. Install the AppArmor profile if the AppImage exits immediately. See [Troubleshooting](TROUBLESHOOTING.md).
3. Install `xvfb`. For the setup session, also install a VNC server such as `x11vnc`.
4. Start once with the window visible:

```sh
OPENBOT_HEADLESS=0 xvfb-run -a -s "-screen 0 1280x800x24" ~/OpenBot.AppImage
```

In another SSH session, attach a VNC server to that `DISPLAY` and tunnel the port to your
computer. Do not publish the VNC port on the VPS firewall.

5. In the window, accept the first-launch consent, sign in, connect a provider, and publish the
   server.
6. Quit that setup process.

## Stay up

```sh
mkdir -p ~/.local/bin ~/.config/systemd/user
cp scripts/openbot-vps.sh ~/.local/bin/openbot-vps
chmod +x ~/.local/bin/openbot-vps
cp deploy/systemd/openbot-host.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now openbot-host.service
sudo loginctl enable-linger "$USER"
```

`loginctl enable-linger` is what keeps the user service running after you disconnect SSH.
`systemctl --user status openbot-host.service` should show the AppImage still running.
Connect from another OpenBot install or the browser client. A reboot should bring the host back.
Closing the hidden window must not.

If the service restarts in a loop, read `journalctl --user -u openbot-host.service`. The usual
cause is a missing AppArmor profile or a missing `xvfb` package.
