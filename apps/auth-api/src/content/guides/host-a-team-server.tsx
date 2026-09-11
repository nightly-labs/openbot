export function HostATeamServer() {
  return (
    <>
      <p>
        A team in OpenBot runs on a computer you own. The hosted part holds accounts, avatars and memberships; it never
        holds your conversations, your files or your commands.
      </p>

      <h2>Turn on the host</h2>
      <p>
        Enable the Team API on the machine that should carry the team. It is usually the one your agents already work
        on, because that is where the workspaces are and the server does not move them.
      </p>

      <h2>Invite somebody</h2>
      <p>
        Send an invitation and let them join from their own copy of OpenBot. Their client talks to your host directly.
        The account service tells the two ends who each other are, and then steps out of the conversation.
      </p>

      <h2>Know what leaves the machine</h2>
      <p>
        Account details, avatars, host addresses and membership go to the hosted service. Threads, attachments, browser
        data and commands do not. Every path out of the app is redacted for secrets before it is taken, including
        diagnostics and analytics.
      </p>
    </>
  );
}
