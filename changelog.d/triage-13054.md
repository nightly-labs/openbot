### Fixed

- When a teammate request fails for a short time, for example because the provider stopped
  responding, the agent that asked sends the request again one time. Before, the agent stopped and
  said that you must fix the cause, also when you had nothing to fix. A routine that hit this now
  continues instead of ending as blocked.
