import { Link } from "@tanstack/solid-router";

export function FixAgentErrors() {
  return (
    <>
      <p>
        Coding agents such as OpenCode and Codex sometimes stop with a short technical error. The text comes from the
        agent's own program, so it often does not tell you what to do next. This guide explains five errors that people
        search for, what causes each one, and how to fix it.
      </p>

      <p>
        Newer OpenBot versions show a clear message for most of these errors. If you still see the raw text, update
        OpenBot first. On a joined server, the server must also be on the new version.
      </p>

      <h2>Quick reference</h2>

      <table>
        <thead>
          <tr>
            <th>Error text</th>
            <th>Agent</th>
            <th>Cause</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>Response still truncated after two output token limit continuations</code>
            </td>
            <td>OpenCode</td>
            <td>The reply was longer than the model's output limit three times.</td>
            <td>Choose a lower effort or another model, or set a larger Max output.</td>
          </tr>
          <tr>
            <td>
              <code>CERT_NOT_YET_VALID: certificate is not yet valid</code>
            </td>
            <td>All</td>
            <td>The date or time on the computer is wrong.</td>
            <td>Correct the date and time.</td>
          </tr>
          <tr>
            <td>
              <code>paginated_threads is not supported yet</code>
            </td>
            <td>Codex (ChatGPT)</td>
            <td>The new session has no saved turn yet.</td>
            <td>Nothing. You can ignore it.</td>
          </tr>
          <tr>
            <td>
              <code>workspace routing discovery unauthorized (401)</code>
            </td>
            <td>Codex (ChatGPT)</td>
            <td>Your ChatGPT sign-in expired.</td>
            <td>Sign in to ChatGPT again.</td>
          </tr>
          <tr>
            <td>
              <code>workspace routing discovery failed</code>
            </td>
            <td>Codex (ChatGPT)</td>
            <td>Codex could not connect to its service.</td>
            <td>Check the network, then try again.</td>
          </tr>
        </tbody>
      </table>

      <h2>"Response still truncated after two output token limit continuations"</h2>

      <p>
        The full error is{" "}
        <code>Internal error: Response still truncated after two output token limit continuations</code>. Each model has
        a maximum length for one reply, the output limit. When the reply reaches it, OpenCode asks the model to
        continue. After two continuations, OpenCode stops the turn.
      </p>

      <p>This usually happens with a very long answer, or with a high reasoning effort that uses most of the limit.</p>

      <ol>
        <li>Choose a lower effort for the agent, or choose another model.</li>
        <li>
          If you use a custom endpoint, open Settings, then Custom provider. Click Edit on the endpoint and set a larger
          Max output for this model. Use a value that the model supports.
        </li>
        <li>Send your message again. For a large task, ask for the result in smaller parts or in a file.</li>
      </ol>

      <h2>"CERT_NOT_YET_VALID: certificate is not yet valid"</h2>

      <p>
        The full error is <code>Internal error: CERT_NOT_YET_VALID: certificate is not yet valid</code>. Each secure
        connection uses a certificate with a start date. When the clock of your computer is earlier than that date, the
        connection fails. The certificate is correct; the clock is wrong.
      </p>

      <ol>
        <li>Open the date and time settings of the computer that runs OpenBot.</li>
        <li>Turn on the automatic date and time, or set the correct date, time and time zone.</li>
        <li>Send your message again.</li>
      </ol>

      <p>
        On a server, check the clock on the server too. On Linux, <code>timedatectl</code> shows the time and whether
        time sync is on.
      </p>

      <h2>"paginated_threads is not supported yet"</h2>

      <p>
        This error can show when a ChatGPT (Codex) agent starts a new session, for example after it moves to a backup
        model. Codex cannot read a session before it saves the first turn. The error is harmless: your agent, its files
        and its history are safe.
      </p>

      <p>
        You do not need to do anything. Since version 0.53.0, OpenBot does not show this as an error. If you still see
        it, update OpenBot.
      </p>

      <h2>"workspace routing discovery unauthorized (401)"</h2>

      <p>
        Codex shows this error when your ChatGPT sign-in has expired. The 401 code means that the service did not accept
        your sign-in.
      </p>

      <ol>
        <li>Open the model picker of the agent, or the ChatGPT provider in Settings.</li>
        <li>Click the sign-in action and sign in to ChatGPT again.</li>
        <li>Send your message again. The agent keeps its workspace and conversation.</li>
      </ol>

      <h2>"workspace routing discovery failed"</h2>

      <p>
        This error, or "workspace routing discovery timed out", means that Codex could not connect to its service when
        it started. The usual cause is a network that is not ready yet, a VPN, a proxy or a firewall. On Windows, some
        root certificates that Codex cannot read can also cause it.
      </p>

      <ol>
        <li>Check that the computer is online and that it can open chatgpt.com.</li>
        <li>Update OpenBot. Newer versions start ChatGPT again after a few seconds by themselves.</li>
        <li>If the error stays, turn off the VPN or proxy for a test, then send your message again.</li>
      </ol>

      <h2>When the error is not in this list</h2>

      <p>
        Read the full message in the chat. OpenBot tells you when the cause is your sign-in, a usage limit or the
        provider service. If an agent cannot continue with one provider, you can choose another provider or a backup
        model for it. The agent keeps its workspace, its conversation and its identity. To learn more about providers
        and models, read{" "}
        <Link to="/guides/$slug" params={{ slug: "openbot-101" }}>
          OpenBot 101
        </Link>
        .
      </p>

      <h2>Frequently asked questions</h2>

      <h3>Do these errors delete my work?</h3>
      <p>
        No. They stop one turn. The agent's files and conversation stay on the computer that runs OpenBot, and you can
        send the message again.
      </p>

      <h3>Why does the error start with "Internal error"?</h3>
      <p>
        "Internal error" is the general error type of the protocol that agent programs use to talk to OpenBot. The text
        after it gives the real cause, as in the errors above.
      </p>

      <h3>Where can I see what changed in each version?</h3>
      <p>
        The <Link to="/changelog">changelog</Link> lists the fixes and the new messages of each OpenBot release.
      </p>
    </>
  );
}
