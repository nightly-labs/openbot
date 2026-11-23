### Fixed

- A Pi agent's shell step now shows the name of the program that it runs, for example "Running the AfterFX.exe command…", and the step history keeps the command. Before, each bash or PowerShell step showed only "Running a command…", so you could not see which command took a long time. A command that starts with a quoted program path, such as `& 'C:\Program Files\…\app.exe'`, also shows the right program name now.
