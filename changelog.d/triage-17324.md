### Fixed

- On Windows, you can delete a server on this computer again. OpenBot now stops all the processes of the server before it moves the server files to the Recycle Bin, and it tries the move again while Windows still uses the files. When the move still fails, the server stays and the app tells you to close the programs that use the files, or to restart the computer, and then to try again.
