### Security

- On a self-hosted server, the `openbot` terminal command checks the values from the server before it uses them, and replaces terminal control characters in the text that it shows with `?`. A Mobile Connect code with other control characters than its colors is refused.
- On a self-hosted server, `sudo openbot` talks only to the OpenBot app that the service started. When a different program holds the control socket, the command stops with "A program that is not OpenBot holds the control socket". The server now installs `iproute2` for this check.
