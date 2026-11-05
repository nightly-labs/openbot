### Changed

- The daily resource summary now tells when the longest main-process delay came (start, wake from
  sleep, first hour or later) and counts helper process exits by process type. The local trace also
  records each main-process delay of 1 second or more. The summary holds no names or paths.
- Usage analytics now include how long OpenBot takes to start and which startup step is slowest,
  how long a turn waits in the queue and until the first output, and, in the daily summary, the
  number of slow tasks and the input delay of the app windows. These are rounded times and counts
  only. The app keeps the time of its last start in a local file to tell a first start after boot.
