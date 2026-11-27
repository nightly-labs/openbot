import { Link } from "@tanstack/solid-router";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";

export function IsOpenBotOpenSource() {
  return (
    <>
      <p>
        Yes, the source code of OpenBot is public. The full code of the desktop app, the server and the mobile app is on{" "}
        <a href={OPENBOT_LINKS.repository} target="_blank" rel={EXTERNAL_LINK_REL}>
          GitHub
        </a>
        . You can read it, build it, change it and run it for free for noncommercial use.
      </p>

      <p>
        The license is the{" "}
        <a href={OPENBOT_LINKS.license} target="_blank" rel={EXTERNAL_LINK_REL}>
          PolyForm Noncommercial License 1.0.0
        </a>
        . It is not an OSI-approved open source license, because commercial use needs a separate license. Many people
        call this model "source-available". This guide explains what the license lets you do, and when you need the
        commercial license.
      </p>

      <h2>OpenBot license at a glance</h2>

      <table>
        <thead>
          <tr>
            <th>Question</th>
            <th>Answer</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Is the source code public?</td>
            <td>Yes. The code of the apps and the server is on GitHub.</td>
          </tr>
          <tr>
            <td>Which license?</td>
            <td>PolyForm Noncommercial 1.0.0.</td>
          </tr>
          <tr>
            <td>Can I use it for free?</td>
            <td>Yes, for any noncommercial purpose.</td>
          </tr>
          <tr>
            <td>Can I change the code?</td>
            <td>Yes, for a noncommercial purpose.</td>
          </tr>
          <tr>
            <td>Can I share my copy?</td>
            <td>Yes, with the license terms and its required notices.</td>
          </tr>
          <tr>
            <td>Can my company use it at work?</td>
            <td>Yes, with a commercial license.</td>
          </tr>
          <tr>
            <td>Do AI agents count as users?</td>
            <td>No. Only people count as seats.</td>
          </tr>
        </tbody>
      </table>

      <h2>What you can do for free</h2>

      <p>The PolyForm Noncommercial License lets you use OpenBot for any noncommercial purpose. Examples are:</p>

      <ul>
        <li>Personal projects, hobby work and private use at home.</li>
        <li>Study, research, experiments and tests.</li>
        <li>Work in a charity, a school or university, a public research group or a government body.</li>
      </ul>

      <p>
        For these purposes, you can also change the code and give copies to other people. Each person who gets a copy
        from you must also get the license terms, or the link to them, and the lines that start with "Required Notice:"
        in the license file.
      </p>

      <h2>When you need the commercial license</h2>

      <p>
        Commercial use is use by a company or another legal entity, or by a person in the course of a business. This
        includes employees who use OpenBot for work, internal business operations, work for clients, and hosting OpenBot
        for other people.
      </p>

      <p>
        For this use, you buy seats. One seat is for one person, and AI agents do not count as seats. The full terms are
        in the <Link to="/commercial-license">OpenBot Commercial License Agreement</Link>, and the current prices are on
        the <Link to="/pricing">Pricing</Link> page.
      </p>

      <h2>Why the code is public</h2>

      <p>
        OpenBot runs AI agents that can open files, use a browser and run commands on your computer or server. With the
        source code, you can check what the app does with your data and what it sends to the network. Your workspaces,
        conversations and files stay on the computer that runs OpenBot. The AI provider that you connect gets the
        prompts it needs to do the work.
      </p>

      <h2>Where to find OpenBot on GitHub</h2>

      <p>
        The repository is{" "}
        <a href={OPENBOT_LINKS.repository} target="_blank" rel={EXTERNAL_LINK_REL}>
          github.com/nightly-labs/openbot
        </a>
        . The ready-to-use builds for macOS, Windows and Linux are on the{" "}
        <a href={OPENBOT_LINKS.releases} target="_blank" rel={EXTERNAL_LINK_REL}>
          Releases
        </a>{" "}
        page and on the <Link to="/download">Download</Link> page. To run OpenBot on a server, read{" "}
        <Link to="/guides/$slug" params={{ slug: "install-openbot-vps" }}>
          How to install OpenBot on a VPS
        </Link>
        .
      </p>

      <h2>Can I contribute?</h2>

      <p>
        Yes. Open an issue or a pull request on GitHub. Before your first pull request is merged, you sign the{" "}
        <Link to="/cla">OpenBot Contributor License Agreement</Link> one time. You keep the copyright in your work, and
        you give the licensor the right to use it.
      </p>

      <h2>Frequently asked questions</h2>

      <h3>Is OpenBot an open source bot?</h3>
      <p>
        Its code is open to read and change, and it is free for noncommercial use. It is not open source in the strict
        OSI meaning, because the license does not let you use it commercially without a commercial license.
      </p>

      <h3>What is PolyForm Noncommercial?</h3>
      <p>
        It is a standard software license from the PolyForm Project. It gives you the right to use, change and share the
        software for any purpose that is not commercial. It also gives a patent license for the same use.
      </p>

      <h3>Can I self-host OpenBot?</h3>
      <p>
        Yes. You can run it on your own computer or on your own server. Hosting it for a business, or as a service for
        other people, is commercial use.
      </p>

      <h3>Can I fork OpenBot and sell it?</h3>
      <p>
        No. Selling a fork, or offering it as a paid service, is commercial use and the free license does not allow it.
      </p>
    </>
  );
}
