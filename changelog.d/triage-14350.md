### Fixed

- On a Mac, an update now installs when macOS runs OpenBot from a temporary copy while OpenBot is already in the Applications folder. Before, OpenBot did not install the update and told you to move it in Finder, and this did not always help. Now OpenBot checks the signature of the copy in the Applications folder, restarts from it, and shows the update again, ready to install.
