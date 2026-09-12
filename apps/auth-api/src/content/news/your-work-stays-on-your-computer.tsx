import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";

export function YourWorkStaysOnYourComputer() {
  return (
    <>
      <p>
        OpenBot keeps your workspaces, conversations, attachments, browser data and team data on the computer that runs
        it. They go into a SQLite database in your own home directory. There is no copy on our side, because there is no
        place on our side to put one.
      </p>

      <h2>What that rules out</h2>
      <p>
        We cannot read your chats. We cannot hand them to anyone who asks us, because we do not hold them. If you delete
        the database, the conversation is gone rather than merely hidden. And the application keeps working when our
        servers do not: OpenBot runs without an account at all.
      </p>
      <p>
        It also changes who is responsible for backups. Nothing is uploaded, so nothing is restored for you. That trade
        is the point, but it is worth knowing before you rely on it.
      </p>

      <h2>The one thing it does not rule out</h2>
      <p>
        Local-first is a claim about storage, not about the network. Your agents still talk to model providers, and
        whatever you send an agent reaches the provider you pointed it at. Pages you open in the built-in browser still
        load from the internet. Plugins can still make requests.
      </p>
      <p>
        The honest version of the promise is narrower than the slogan: OpenBot adds no hop of its own. We wrote down
        exactly which data leaves your machine and why in the{" "}
        <a href={OPENBOT_LINKS.privacy} target="_blank" rel={EXTERNAL_LINK_REL}>
          privacy notes
        </a>
        .
      </p>

      <h2>What an account is for</h2>
      <p>
        You can sign in, and some things do need one: your profile and avatar, host configuration, team memberships,
        invitations and the logical sessions that let devices find each other. That list is deliberately short, and it
        is the whole of it. Chats, files and commands are not on it.
      </p>
      <p>
        Your database stays the source of truth. The account is not a cache of your work that happens to live elsewhere;
        it is the small amount of shared state that two machines need in order to agree they belong to the same person.
      </p>
    </>
  );
}
