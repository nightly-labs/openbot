import { ArticleImage } from "../../components/content/ArticleMedia";
import importFinished from "./media/import-hermes-agents/import-finished.png";
import importSource from "./media/import-hermes-agents/import-source.png";
import installCommand from "./media/import-hermes-agents/install-command.png";
import manualSetup from "./media/import-hermes-agents/manual-setup.png";
import readFolder from "./media/import-hermes-agents/read-folder.png";
import reviewProfiles from "./media/import-hermes-agents/review-profiles.png";

export function ImportHermesAgents() {
  return (
    <>
      <p>
        You can move your Hermes Agent setup into OpenBot without rebuilding every agent from scratch. Each Hermes
        profile becomes an OpenBot agent, with its own instructions, saved memories and custom skills where available.
      </p>

      <p>
        OpenBot shows you what it found before you import. You choose the profiles to bring over, check which items will
        move and allow any optional items you want to include. Your original Hermes profiles stay where they are.
      </p>

      <h2>Before you start</h2>

      <p>
        Update OpenBot and decide where your imported agents should live. For the folder method below, use the OpenBot
        desktop app on the same computer as Hermes and select that computer as your destination.
      </p>

      <p>
        If Hermes is on another computer, or you use OpenBot in the browser or on a joined server, use the ZIP export
        method later in this guide.
      </p>

      <h2>1. Open Import in OpenBot</h2>

      <p>
        Open <strong>Server settings → Import</strong>, then choose <strong>Hermes Agent</strong>.
      </p>
      <ArticleImage
        src={importSource}
        alt="OpenBot Import settings with Hermes Agent, Grok Bot and another OpenBot computer as source options."
        width={1184}
        height={737}
        caption="Choose Hermes Agent in the Import settings."
      />

      <p>Choose the option that matches where Hermes runs and how you want to prepare the import.</p>

      <h2>2. Choose an import option</h2>

      <table>
        <thead>
          <tr>
            <th>Option in OpenBot</th>
            <th>When to use it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Read this computer</strong>
            </td>
            <td>Hermes is on the same computer as the OpenBot desktop app. No ZIP is needed.</td>
          </tr>
          <tr>
            <td>
              <strong>Install with a command</strong>
            </td>
            <td>Add the export skill in Hermes with one command, then import its ZIP into OpenBot.</td>
          </tr>
          <tr>
            <td>
              <strong>Set it up yourself</strong>
            </td>
            <td>Save the supplied skill file in Hermes yourself, then use the same ZIP export flow.</td>
          </tr>
        </tbody>
      </table>

      <p>
        For the two ZIP options, prepare the export on the computer where Hermes runs. You can then import it through
        the OpenBot desktop app, the browser or a joined server.
      </p>

      <h3>Option 1: Read this computer</h3>

      <p>
        Select <strong>Read the Hermes folder</strong>. OpenBot reads the profiles it finds without changing the Hermes
        folder.
      </p>
      <ArticleImage
        src={readFolder}
        alt="Hermes import controls with Read this computer selected and the Read the Hermes folder button."
        width={1184}
        height={430}
        caption="Read this computer: open the local Hermes profiles directly."
      />

      <p>
        The usual folder is <code>~/.hermes</code>. If OpenBot cannot find your profiles, use{" "}
        <strong>Choose the Hermes folder</strong> and select the folder your installation uses. On the profile preview,{" "}
        <strong>Choose another folder</strong> lets you change it.
      </p>

      <p>You do not need to make a ZIP for this method. OpenBot takes you straight to the profiles it found.</p>

      <p>Once the folder has been read, continue to step 3 to review the profiles.</p>

      <h3>Option 2: Install with a command</h3>

      <p>
        This option adds the OpenBot export skill to Hermes. It is useful when Hermes runs on another computer, or when
        you want to import through the browser or into a joined OpenBot server.
      </p>

      <p>
        In <strong>Server settings → Import → Hermes Agent</strong>, choose <strong>Install with a command</strong>.
        Copy the command into a Hermes chat:
      </p>
      <ArticleImage
        src={installCommand}
        alt="Hermes import controls with Install with a command selected, showing the skill installation command."
        width={1184}
        height={430}
        caption="Install with a command: add the export skill from a Hermes chat."
      />

      <pre>
        <code>/skills install nightly-labs/openbot/resources/agent-import/hermes-agent</code>
      </pre>

      <p>Hermes scans the skill before installing it. If you prefer the terminal, use:</p>

      <pre>
        <code>hermes skills install nightly-labs/openbot/resources/agent-import/hermes-agent</code>
      </pre>

      <p>After installing the skill, follow the ZIP export steps below.</p>

      <h3>Option 3: Set it up yourself</h3>

      <p>
        Use this option if you prefer to add the export skill as a file. On the Hermes Agent import page in OpenBot,
        choose <strong>Set it up yourself</strong>.
      </p>
      <ArticleImage
        src={manualSetup}
        alt="Hermes import controls with Set it up yourself selected and Copy and Save file actions for SKILL.md."
        width={1184}
        height={430}
        caption="Set it up yourself: copy or save the export skill file in Hermes."
      />

      <p>
        Select <strong>Save file…</strong> to save the supplied <code>SKILL.md</code>, or use <strong>Copy</strong> and
        paste its complete contents into a file with that name.
      </p>

      <p>
        Save it at <code>~/.hermes/skills/openbot-export/SKILL.md</code>. If your Hermes installation uses a different
        home folder, put it in that folder under <code>skills/openbot-export/SKILL.md</code>. Create the{" "}
        <code>openbot-export</code> folder if needed.
      </p>

      <p>
        Start a new Hermes chat so it can find the skill. The export leaves this helper skill out of the ZIP. You do not
        need to run the installation command as well.
      </p>

      <h3>Export a ZIP for options 2 and 3</h3>

      <p>
        Both <strong>Install with a command</strong> and <strong>Set it up yourself</strong> continue with the same
        export step. In Hermes, send:
      </p>

      <pre>
        <code>/openbot-export</code>
      </pre>

      <p>
        Choose the profiles you want to export and wait for the completed ZIP in Downloads. Its name will look like{" "}
        <code>openbot-export-hermes-2026-10-28.zip</code>.
      </p>

      <p>
        This export can carry your persona, saved memories, custom skills and supported recurring jobs. It leaves out
        credentials, chat sessions, bundled skills and MCP server settings. The ZIP export skill also leaves out
        one-time jobs; read its summary of skipped items.
      </p>

      <p>
        Return to OpenBot, select <strong>Choose export file</strong>, and choose the completed ZIP without unzipping
        it. OpenBot opens a preview. Continue to step 3 to review it before importing.
      </p>

      <h2>3. Review what will move</h2>

      <p>
        You can review the import before OpenBot adds the agents. The preview depends on whether you read the Hermes
        folder or selected a ZIP.
      </p>

      <h3>If you read the Hermes folder</h3>

      <p>
        Use the checkbox beside each profile to choose which agents you want in OpenBot. You can start with one profile
        and bring over the others later. The default profile appears as <strong>Hermes</strong>; named profiles appear
        separately.
      </p>

      <p>
        Expand the item count beside a profile, such as <strong>4 items</strong>, to see its contents. The labels
        explain what will happen:
      </p>

      <ul>
        <li>
          <strong>Imports</strong> means the item will come with the selected profile.
        </li>
        <li>
          <strong>Allow</strong> means the item needs a separate choice before it can be included. For example, a custom
          skill that runs code needs your approval.
        </li>
        <li>
          <strong>Not imported</strong> means the item will stay behind. Read the reason shown under it.
        </li>
      </ul>

      <p>
        In the example below, <code>SOUL.md</code> will become the agent's instructions. The built-in Hermes skills,
        secrets and past sessions are marked <strong>Not imported</strong>. Your list may contain different items and
        counts.
      </p>
      <ArticleImage
        src={reviewProfiles}
        alt="One selected Hermes profile with SOUL.md marked Imports, built-in skills, secrets and past sessions marked Not imported, and an Import 1 agent button."
        width={1504}
        height={1177}
        caption="Select the profiles you want, then check what imports and what stays in Hermes."
      />

      <p>
        If a profile has saved memories, OpenBot can bring over entries from <code>MEMORY.md</code> and{" "}
        <code>USER.md</code>. Custom skills can come too; skills bundled with Hermes are left out. If the profile only
        has Hermes's starting persona text, the new agent keeps OpenBot's starting instructions.
      </p>

      <p>
        Supported scheduled jobs become OpenBot routines. Check their schedules and enabled state before importing:
        enabled routines can remain enabled. Jobs that only run a script and unsupported schedules are left out with a
        reason.
      </p>

      <p>
        If the list includes MCP servers, these are connections to tools and services. You can allow supported
        connection settings to be added. They arrive turned off, with sensitive connection values cleared, so you can
        check them before use.
      </p>

      <h3>If you selected a ZIP</h3>

      <p>
        Select the agents you want in the ZIP preview. Check the counts of included memories, skills, routines and
        files, and read any warnings about items that will not move.
      </p>

      <p>
        A ZIP import creates separate agents. If a name already exists, OpenBot asks you to confirm the duplicate when
        you start the import. It does not offer the folder method's linked-profile update.
      </p>

      <h2>4. Import the selected agents</h2>

      <p>
        Check your selected agents and any items you allowed, then select the Import button. Its label shows your
        selection, such as <strong>Import 1 agent</strong>.
      </p>

      <p>
        When the process finishes, OpenBot shows <strong>Import finished</strong> and lists the imported agents. Read
        any warnings or <strong>Not imported</strong> results, then open an agent from the list or select{" "}
        <strong>Done</strong>.
      </p>
      <ArticleImage
        src={importFinished}
        alt="Hermes Agent import result showing Import finished, 1 agent imported, the Hermes agent and a Done button."
        width={1504}
        height={669}
        caption="The result screen lists the agents imported into OpenBot."
      />

      <p>
        If you read the same Hermes folder again later, OpenBot recognizes profiles it imported before.{" "}
        <strong>Update it</strong> updates the linked agent while keeping its OpenBot chats. <strong>Leave it</strong>{" "}
        keeps that agent as it is.
      </p>

      <h2>5. Check the agent before its first task</h2>

      <p>
        Open the imported agent and check its instructions, memories, skills and routines. Choose the provider and model
        you want it to use in OpenBot, then complete any sign-in it needs.
      </p>

      <p>
        If a custom persona was too long for the instructions field, folder import saves the full version in{" "}
        <code>imported/hermes/SOUL.md</code> and leaves a shorter instruction pointing to it.
      </p>

      <p>
        If you allowed MCP settings, check them in OpenBot's MCP settings, supply any required values and enable the
        connection when ready. Messaging connections and Hermes terminal backends also need to be set up for the way you
        work in OpenBot.
      </p>

      <p>
        Project documents and a complete working directory are not part of the standard Hermes profile import. Bring any
        files your agent needs separately.
      </p>

      <p>A useful first request is:</p>

      <blockquote>
        <p>
          Check your instructions, saved memories and installed skills. Tell me which tools and files are available and
          which connections still need setting up. Do not send messages, publish content or change project files.
        </p>
      </blockquote>

      <h2>What stays in Hermes?</h2>

      <p>
        Full chat history stays in Hermes. OpenBot brings over saved memory entries, subject to its memory limits. Read
        any warnings to see what could not be included.
      </p>

      <p>
        Credential files and login sessions are not transferred. Reconnect providers and services in OpenBot. Also check
        any sensitive information you may have written into your own instructions or memories.
      </p>

      <p>
        For the folder method, the reader leaves the source profiles unchanged. For a ZIP import into a joined server,
        the file goes through the host connection to the computer running that server. Check the selected destination
        before importing.
      </p>

      <h2>Frequently asked questions</h2>

      <p>
        <strong>Will each Hermes profile become a separate agent?</strong> Yes. Select the profiles you want on the
        preview screen.
      </p>

      <p>
        <strong>Can I keep the same personality and memories?</strong> Your custom persona and saved memory entries can
        be brought over. A different model or set of tools can still change how the agent behaves, so start with a small
        task.
      </p>

      <p>
        <strong>Will all tools work immediately?</strong> Some items need your approval or a new connection. MCP
        settings imported from a folder arrive turned off. Provider sign-ins, credentials and messaging connections need
        to be set up again.
      </p>
    </>
  );
}
