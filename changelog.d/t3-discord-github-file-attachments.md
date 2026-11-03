### Added

- A workflow that a Discord mention starts now keeps the files of the message. Agent steps get the name, type, size and address of each file. A GitHub output that makes a new issue or a comment copies the files to the `openbot-attachments` branch of the repository and shows them in the text: images show in the issue, other files are links. A file larger than 25 MB, or a file that cannot be copied, is linked on Discord, where its address expires after about a day.
