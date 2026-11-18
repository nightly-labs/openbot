### Fixed

- Your agents now keep working while OpenBot downloads a provider update. Before, all agents on that
  provider stopped answering for the whole download, and when the connection stopped during the
  download, they did not answer again until you restarted OpenBot. Now they wait only while the new
  version is put in place. A download that gets no data for one minute stops, says so in
  Settings > Providers, and continues from where it stopped when you try again.
