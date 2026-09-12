import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";

export function OneAgentManyProviders() {
  return (
    <>
      <p>
        Most tools tie the assistant to the model. Change the model and you start again: new chat, new working
        directory, none of the history that made the last answer good. The model is a setting, so it should behave like
        one.
      </p>

      <h2>What an agent keeps</h2>
      <p>
        In OpenBot an agent owns three things that outlive any provider it runs on: a workspace on disk, a thread of
        everything it has done, and an identity of its own. Point the same agent at{" "}
        <a href={OPENBOT_LINKS.codex} target="_blank" rel={EXTERNAL_LINK_REL}>
          Codex
        </a>{" "}
        instead of{" "}
        <a href={OPENBOT_LINKS.claude} target="_blank" rel={EXTERNAL_LINK_REL}>
          Claude Code
        </a>{" "}
        and it is still the same agent, in the same folder, with the same history behind it.
      </p>
      <p>
        Restarting the application does not reset it either. An agent that was halfway through something is still
        halfway through it tomorrow.
      </p>

      <h2>Why it is built this way</h2>
      <p>
        The alternative is tempting and we decided against it. Wiping an agent on a provider switch would make the state
        easy to reason about, because there would be almost none. It would also make the feature useless: the only
        reason to move an agent between providers is to keep what it already knows and change how it thinks.
      </p>
      <p>
        So the provider session is kept separate from the thread. The session is private resume state belonging to one
        command-line tool. The thread is yours, and it is what survives.
      </p>

      <h2>What this is good for</h2>
      <p>
        Run the cheap model until the work gets hard, then move that exact agent up to a stronger one without
        re-explaining the task. Move it back down when the hard part is finished. Try the same job on two providers and
        compare the results rather than the setup effort.
      </p>
    </>
  );
}
