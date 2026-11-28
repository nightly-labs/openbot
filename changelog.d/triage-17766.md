### Fixed

- An agent can publish or replace a site again about 2 minutes after a file upload stopped or site storage did not answer. Before, each try failed with "Wait for the file upload to finish." for up to 15 minutes, and a new site kept the only free site slot. The fix is in the account service, so installed apps get it too.
