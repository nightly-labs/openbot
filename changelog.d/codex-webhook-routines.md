### Added

- Add a webhook trigger to teammate and group routines. In **When to run**, open **Change trigger** and select **Webhook**. The routine gets its own endpoint and signing secret. A signed request to the endpoint starts the routine. Select **Filter events** to limit the routine to one event type and to data filters.
- The **Change trigger** menu shows each schedule and the webhook with one line that tells when the routine runs.
- You see the signing secret of a webhook routine one time when you save it, and you can make a new secret. When you change the routine to a schedule or delete it, its endpoint stops working.
- The routine **History** shows runs and the webhook requests that the routine ignored. Event data stays on the host computer. The host must be online to receive webhook requests.
