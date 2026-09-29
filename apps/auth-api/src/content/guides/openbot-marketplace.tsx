import { ArticleImage } from "../../components/content/ArticleMedia";
import agentDetail from "./media/openbot-marketplace/agent-detail.png";
import githubPlugin from "./media/openbot-marketplace/github-plugin.png";
import marketplace from "./media/openbot-marketplace/marketplace.png";
import marketplaceMenu from "./media/openbot-marketplace/marketplace-menu.png";

const GUIDE_TITLE = "How to Use the OpenBot Marketplace: Agents, Skills, and Plugins";

export function OpenBotMarketplace() {
  return (
    <>
      <p>
        A useful agent takes more than a name. It needs instructions for the work it does, and it may have skills or
        routines too. The OpenBot Marketplace lets you add an agent someone else has shared, find plugins and skills for
        your own agents, or submit an agent you have built.
      </p>

      <h2>Browse the Marketplace</h2>
      <p>
        In the desktop app, click the puzzle-piece icon at the top of OpenBot’s sidebar. The Marketplace has three tabs:{" "}
        <strong>Agents</strong>, <strong>Plugins</strong>, and <strong>Skills</strong>. You can browse the listings by
        category or search for a creator or item by name. Open a listing to see what it does before adding it.
      </p>
      <ArticleImage
        src={marketplace}
        alt="OpenBot Marketplace with the Agents tab selected and the Plugins and Skills tabs visible. Agent listings are grouped by category."
        width={2052}
        height={1374}
        mountOn={GUIDE_TITLE}
        caption="Agents, plugins, and skills each have their own Marketplace tab."
      />

      <h2>Add an Agent from the Marketplace</h2>
      <p>
        In the <strong>Agents</strong> tab, open a listing and read its instructions. They tell you what the agent is
        meant to do and how it approaches the work. A listing may also include skills (playbooks for particular tasks)
        and routines (tasks the agent can run on a schedule).
      </p>
      <ArticleImage
        src={agentDetail}
        alt="The Code Review Partner agent listing, showing its instructions, skills, and Install agent button."
        width={2086}
        height={1412}
        mountOn={GUIDE_TITLE}
        caption="Read the agent’s instructions and check its included skills and routines before installing."
      />
      <p>
        If the setup fits, select <strong>Install agent</strong>. OpenBot adds a copy of the agent setup, not the
        creator’s conversations, memories, model settings, or workspace files. Choose the provider you want to use and
        adjust the instructions for your project. Check its routines too: ones marked active in the shared setup stay
        active when installed.
      </p>

      <h2>Add a Plugin or Skill to an Agent</h2>
      <p>
        A plugin connects an agent to an app or service. Open a plugin listing to see what it can do and the example
        tasks it supports. Choose an agent, then select <strong>Install plugin</strong>. If the plugin includes skills,
        those are added to the agent you chose. The app connection itself is saved on the computer running OpenBot. Some
        plugins also need you to sign in or provide a credential before they can work.
      </p>
      <ArticleImage
        src={githubPlugin}
        alt="The GitHub plugin listing, with example requests, a selected agent, and the Install plugin button."
        width={2086}
        height={1408}
        mountOn={GUIDE_TITLE}
        caption="The GitHub plugin listing shows example tasks and which agent will receive its skills."
      />
      <p>
        A skill is a set of instructions for a particular kind of task. In the <strong>Skills</strong> tab, open a
        listing, choose an agent, and select <strong>Install skill</strong>. A skill guides how the agent works; a
        plugin gives it a connection to another service.
      </p>
      <p>
        Check what access a plugin needs before installing it. The GitHub plugin, for example, can work with the
        repositories your personal access token can reach. Its token is saved on your computer, but it is sent to
        GitHub’s remote service with requests. Give it only the access you are comfortable sharing.
      </p>

      <h2>Submit Your Agent to the Marketplace</h2>
      <p>
        To share an agent, open the three-dot menu in the Marketplace and select <strong>Add agent</strong>. Before
        submitting, check the agent’s full instructions, skills, and routines in its settings. Remove any credentials or
        private details from that setup, and make sure its routines are suitable for someone else to run.
      </p>
      <ArticleImage
        src={marketplaceMenu}
        alt="The Marketplace menu with Discover, My submissions, Add agent, and Refresh options."
        width={2322}
        height={1408}
        mountOn={GUIDE_TITLE}
        caption="Use Add agent in the Marketplace menu to start a submission."
      />
      <p>
        Choose the local agent you want to share, review its name and description, and pick a category. The submission
        preview shows a summary and counts of included skills and routines; it does not show their full contents. Select{" "}
        <strong>Submit for review</strong> when you are ready. Conversations, memories, model settings, and workspace
        files are not part of the submitted template.
      </p>
      <p>
        You can follow the review in <strong>My submissions</strong>. Once an agent is approved, other people can find
        and install it from the Marketplace. If you need to revise a submission, you can send a new version.
      </p>
    </>
  );
}
