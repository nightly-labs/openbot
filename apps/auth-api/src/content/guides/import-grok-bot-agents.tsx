import { ArticleImage } from "../../components/content/ArticleMedia";
import addMigrator from "./media/import-grok-bot-agents/add-migrator.png";
import exportInstructions from "./media/import-grok-bot-agents/export-instructions.png";
import importSource from "./media/import-grok-bot-agents/import-source.png";

export function ImportGrokBotAgents() {
  return (
    <>
      <p>
        You can bring your Grok Bot agents into OpenBot without rebuilding their setup one by one. An export agent in
        Grok Bot packs the agents you choose into a ZIP file. OpenBot reads that file, shows a preview and creates the
        selected agents.
      </p>

      <p>
        The import can carry instructions, avatars, skills, routines, memories and optional workspace files. Group chats
        can become OpenBot channels. Original chat transcripts are not transferred: the export agent saves important
        facts from them as memories instead.
      </p>

      <h2>Before you start</h2>

      <p>
        Update OpenBot and decide where the agents should live: on this computer or on an OpenBot server you have
        joined. The import goes into the server whose settings you open.
      </p>

      <p>
        You will also need access to your agents in Grok Bot and somewhere to save the export file. You can keep using
        the originals while you check the copies in OpenBot.
      </p>

      <h2>1. Open Import in OpenBot</h2>

      <p>
        Open <strong>Server settings → Import</strong>, then choose <strong>Grok Bot</strong>.
      </p>
      <ArticleImage
        src={importSource}
        alt="OpenBot Import settings showing Grok Bot as an import source."
        width={1184}
        height={737}
        caption="Choose Grok Bot as the import source in OpenBot."
      />

      <p>
        The page shows the export instructions and a card for <strong>OpenBot export</strong>. Select{" "}
        <strong>Open the export agent</strong>. This opens the Grok Bot page for <strong>Migrator by OpenBot</strong>,
        the agent prepared for this job.
      </p>

      <p>
        Add it to Grok Bot. It is a separate export agent; you do not need to replace the instructions of an agent you
        already use.
      </p>
      <ArticleImage
        src={addMigrator}
        alt="Migrator by OpenBot in Grok Bot, with the Add Bot button."
        width={880}
        height={962}
        caption="Add Migrator by OpenBot to Grok Bot."
      />

      <h2>2. Ask the export agent to prepare your agents</h2>

      <p>Send this message in the export agent's Grok Bot conversation:</p>

      <blockquote>
        <p>Export my agents for OpenBot</p>
      </blockquote>
      <ArticleImage
        src={exportInstructions}
        alt="OpenBot instructions for adding the Grok Bot export agent, requesting an export and choosing the ZIP file."
        width={1184}
        height={1127}
        caption="Use the export message shown in OpenBot, then return with the completed ZIP file."
      />

      <p>
        It should list the agents and group chats it finds, then ask which ones you want and whether to include
        workspace files. Choose a small set for your first import if you would like to check the result before moving
        the rest.
      </p>

      <p>
        Including files brings the selected working documents along. Leaving them out makes a smaller export. The export
        skill tells the agent to exclude credential files, passwords, tokens and other secrets; keep these out of any
        material you include.
      </p>

      <p>The export agent leaves itself out of the archive. It also leaves out its own export skill.</p>

      <h2>3. Save the ZIP file</h2>

      <p>
        When the export finishes, the agent should give you one file in <strong>Downloads</strong>, named like{" "}
        <code>openbot-export-2026-10-27.zip</code>. The date in the name depends on when you export it.
      </p>

      <p>
        Use the completed ZIP file. Do not unzip it or select a temporary <code>.zip.part</code> file.
      </p>

      <p>
        Read the export agent's summary of what it included and anything it could not read. If an important agent or
        file is missing, ask it to correct the export before continuing.
      </p>

      <h2>4. Review the export in OpenBot</h2>

      <p>
        Return to <strong>Server settings → Import → Grok Bot</strong> and select <strong>Choose export file</strong>.
      </p>

      <p>
        OpenBot shows the agents before importing them, with counts for items such as skills, routines, memories and
        files. If the export includes group chats, review the channels too. A channel needs at least one of its agents
        selected to be imported.
      </p>

      <p>
        Select the agents and channels you want. Read any warnings about items that will not move, then use the Import
        button showing your selected counts.
      </p>

      <p>
        If a matching agent name already exists, OpenBot asks you to confirm the duplicate. A ZIP import creates a
        separate agent; it does not update the existing one.
      </p>

      <h2>5. Check the result</h2>

      <p>
        The <strong>Import finished</strong> screen lists what was imported and anything that was skipped. Open an
        imported agent and check its instructions, memories, skills and routines.
      </p>

      <p>
        Workspace files included in the export are placed in an <code>imported/</code> folder inside that agent's
        OpenBot workspace. If the original instructions were long, the export may keep a short version in the
        instructions and put the full text in <code>imported/INSTRUCTIONS.md</code>.
      </p>

      <p>
        Choose the provider and model you want to use in OpenBot, and complete any sign-in it requires. Moving an
        agent's setup does not transfer a Grok Bot subscription or sign-in session.
      </p>

      <p>
        Review enabled routines and their times before relying on them. Then give the agent one small task, such as:
      </p>

      <blockquote>
        <p>
          Read your imported instructions and memories, list the files you can find in imported/, and tell me what needs
          setting up before you continue my work. Do not send or publish anything.
        </p>
      </blockquote>

      <h2>What moves, and what stays behind?</h2>

      <p>
        The export is designed to carry the agent's name, role, instructions, avatar, skills, supported routines and
        memories. Selected working files are optional. Group-chat setup, membership and saved facts can become channels
        and channel memories.
      </p>

      <p>
        The original conversations do not become OpenBot chat history. Memories are a summary of selected facts, so
        check that the preferences, decisions and unfinished work you care about are represented correctly. Provider
        access and external services may need to be connected again.
      </p>

      <p>
        For an import into this computer, OpenBot reads the ZIP locally. For a joined server, the ZIP is sent through
        the encrypted host connection to the computer running that server. If a remote export is too large, try fewer
        agents or leave workspace files out.
      </p>

      <h2>If the import does not work</h2>

      <p>
        If you cannot find the Grok Bot source, check that OpenBot is up to date and that you opened the settings of the
        intended server.
      </p>

      <p>
        If the ZIP is rejected, ask the export agent to rebuild it using the OpenBot export skill. It needs the OpenBot
        import format; a general backup of the Grok Bot workspace is not the same file.
      </p>

      <p>
        If only part of an import succeeds, read <strong>Not imported</strong> and the warnings before trying again.
        Select the missing agents on a retry so you do not create extra copies of agents that already arrived.
      </p>

      <h2>Frequently asked questions</h2>

      <p>
        <strong>Will I keep all my chat history?</strong> No. The export agent turns important facts into memories.
        Original messages and their full conversation history are not imported.
      </p>

      <p>
        <strong>Can I move only one agent?</strong> Yes. Choose it when preparing the export or select only that agent
        in OpenBot's preview.
      </p>

      <p>
        <strong>What if I cannot install the ready export agent?</strong> OpenBot also offers{" "}
        <strong>Set it up yourself</strong>. Copy or save the supplied <code>SKILL.md</code>, add it to a separate
        export agent in Grok Bot, then send the same export message.
      </p>
    </>
  );
}
