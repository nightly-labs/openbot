import { Link } from "@tanstack/solid-router";

export function RunTheTeamServerYourself() {
  return (
    <>
      <p>
        OpenBot works with no account at all. Everything that makes the app useful on your own machine — agents,
        threads, workspaces, files — is there the moment you open it, and none of it needs us.
      </p>

      <h2>What a team adds</h2>
      <p>
        A team is what you want when a second person needs to see the work. One computer runs the host, the others join
        it, and the chats and files stay on the machine that runs the host. If you run that host yourself, it is your
        hardware and your network.
      </p>

      <h2>What the account is for</h2>
      <p>
        There is an account service, and it is deliberately small. It holds accounts, avatars, memberships, invitations
        and the configuration that lets one computer find another. It does not hold your conversations, your files or
        your commands, and it is not in the path when you use the app alone.
      </p>
      <p>
        The account service is separate from the team server. With self-hosting, the host and your work run on hardware
        you control. With an OpenBot hosted server, OpenBot provides the Linux machine and your team's work stays there
        instead of on your own computer. The account service still handles memberships and invitations. See our{" "}
        <Link to="/guides/$slug" params={{ slug: "openbot-hosted-servers" }}>
          guide to OpenBot hosted servers
        </Link>{" "}
        for the plans and setup.
      </p>
      <p>
        We drew that line early because it is the kind of boundary that is hard to move later: the account service helps
        devices find each other, but it is not a second copy of the work.
      </p>

      <h2>The trade you are making</h2>
      <p>
        Self-hosting means uptime is yours. If the machine that runs the host is asleep, the team is offline, and no one
        else is going to wake it up for you. That is the cost, and it is worth knowing before you build a workflow that
        depends on it.
      </p>
    </>
  );
}
