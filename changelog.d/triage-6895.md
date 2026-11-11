### Fixed

- An agent can upload the same file in many browser tabs, for example one video to several social sites. Before, each upload kept its own copy of the file until its tab closed, and after about 500 MB the browser refused all new uploads. Now an upload of an unchanged file uses the copy that OpenBot already keeps. When the limit stops an upload, the agent is told to close the tabs whose uploads are finished.
