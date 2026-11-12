// Checks that file links open from a channel (#2816), in this worktree's running dev app with a real
// provider turn. Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/channel-file-link-e2e.ts --allow-mutations`. It needs one visible agent whose
// provider is signed in.
//
// It writes one file in the shared directory and one in the agent's workspace, makes a channel with
// the agent, and sends a message with a link to each file. The person's message must show the shared
// link and no workspace link, because a person's message in a channel names no workspace. The
// agent repeats the workspace link, and each link must open its file in the preview panel. A quote of
// the workspace file must name its absolute path and open the file again. When the agent's access is
// not limited to its workspace, the agent reads a file outside its workspace in the channel and links
// it by its name only; the link must open that file from the agent's tool history. Then the same links
// must still open from the person's message in the agent's own chat. It deletes its channel and its
// files at the end.
// Writes .openbot-build/channel-file-link-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { workspaceAccessEnforced } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { ChannelClient, connectChannelE2e, WAIT_MS, waitFor, writeReport } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-file-link-e2e");
const UI_WAIT_MS = 15_000;
const english = translateFor("en");

interface Report {
  channelId?: string;
  shared?: { linkShown: boolean; opened: boolean; workspaceLinksInFile: number };
  workspace?: { linkInOwnMessage: number; linkInAgentReply: boolean; opened: boolean };
  quote?: { absolutePath: boolean; reopened: boolean };
  /** A file outside the workspace that the agent read in the channel, linked by its name only. */
  outside?: { opened: boolean } | { skipped: "workspace access" };
  directChat?: { sharedOpened: boolean; workspaceOpened: boolean; workspaceLinksInSharedFile: number };
  /** What the agent wrote, and the state of its task, when a step fails. */
  agentReplies?: string[] | undefined;
  taskStates?: string[] | undefined;
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { pageErrors: [], screenshots: [], passed: false };
const session = await connectChannelE2e("channel-file-link-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const client = new ChannelClient(page);
const id = crypto.randomUUID().slice(0, 8);
const name = `E2E files ${id.slice(0, 4)}`;
const sharedName = `e2e-channel-shared-${id}.md`;
const sharedText = `Shared spec ${id}`;
const workspaceName = `e2e-channel-workspace-${id}.md`;
const workspaceText = `Workspace spec ${id}`;
const outsideName = `e2e-channel-outside-${id}.md`;
const outsideText = `Outside spec ${id}`;
const outsideFile = join(OUT, `outside-${id}`, outsideName);
// The dev profile uses the real ~/OpenBot folder, so the script removes only the files it wrote.
const sharedFile = join(homedir(), "OpenBot", "Shared", sharedName);
let workspaceFile: string | null = null;
mkdirSync(OUT, { recursive: true });

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const conversation = () => page.getByRole("main", { name: english("conversation.view.label") });
const panel = () => page.getByRole("complementary", { name: english("preview.panel.label"), exact: true });
const sharedLink = () =>
  conversation().getByRole("button", { name: english("chat.file.openShared", { name: sharedName }), exact: true });
const workspaceLink = () =>
  conversation().getByRole("button", {
    name: english("chat.file.openWorkspace", { name: workspaceName }),
    exact: true,
  });

const panelWorkspaceLink = () =>
  panel().getByRole("button", { name: english("chat.file.openWorkspace", { name: workspaceName }), exact: true });

async function shot(label: string): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

try {
  const [agent] = await client.agents();
  assert.ok(agent, "This check needs one visible agent.");
  mkdirSync(join(homedir(), "OpenBot", "Shared"), { recursive: true });
  writeFileSync(sharedFile, `# ${sharedText}\n\n[inner spec](${workspaceName})\n`);
  workspaceFile = join(agent.workspacePath, workspaceName);
  writeFileSync(workspaceFile, `# ${workspaceText}\n`);

  const channel = await client.create(name, [agent.id], agent.id);
  report.channelId = channel.id;
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(name)}[,.]`) })
    .first()
    .click();
  await conversation().getByRole("heading", { level: 1, name, exact: true }).waitFor({ timeout: UI_WAIT_MS });

  await client.send(
    channel.id,
    [
      "Reply with exactly the next line and nothing else. Do not use tools.",
      `[workspace spec](${workspaceName})`,
      "",
      `The shared spec: [shared spec](~/OpenBot/Shared/${sharedName})`,
    ].join("\n"),
    agent.id,
  );

  // 1. The person's message links the shared file, and its workspace path stays text.
  await sharedLink().first().waitFor({ timeout: UI_WAIT_MS });
  const linkInOwnMessage = await workspaceLink().count();
  await sharedLink().first().click();
  await panel().getByText(sharedText).waitFor({ timeout: UI_WAIT_MS });
  // The shared file names no agent, so in a channel its workspace path stays text.
  const workspaceLinksInSharedFile = await panelWorkspaceLink().count();
  report.shared = { linkShown: true, opened: true, workspaceLinksInFile: workspaceLinksInSharedFile };
  await shot("shared-preview");

  // 2. The agent's reply links its workspace file, and the link opens it.
  await workspaceLink().first().waitFor({ timeout: WAIT_MS });
  await workspaceLink().first().click();
  await panel().getByText(workspaceText).waitFor({ timeout: UI_WAIT_MS });
  report.workspace = { linkInOwnMessage, linkInAgentReply: true, opened: true };
  await shot("workspace-preview");

  // 3. A quote of the workspace file names its absolute path, and the quote opens the file again.
  await panel().getByText(workspaceText).selectText();
  // The selection actions read the selection on a key or pointer release.
  await page.keyboard.press("Shift");
  await page.getByRole("button", { name: english("chat.selection.quote"), exact: true }).click();
  await conversation()
    .getByRole("button", { name: english("composer.send.message"), exact: true })
    .click();
  const quoteId = await waitFor(
    page,
    "the sent quote",
    async () =>
      (await client.read(channel.id)).messages
        .filter((entry) => entry.author.kind === "member")
        .map((entry) => /\(quote(?:\+uri)?:([^)]*)\)/u.exec(entry.message.text)?.[1])
        .find((quote) => quote !== undefined),
    (quote) => quote !== undefined,
    UI_WAIT_MS,
  );
  // The file tab closes the preview in the side panel, so the header button collapses the panel.
  await conversation()
    .getByRole("button", { name: english("conversation.sidePanel.close"), exact: true })
    .first()
    .click();
  await panel().getByText(workspaceText).waitFor({ state: "hidden", timeout: UI_WAIT_MS });
  await conversation()
    .getByRole("button", { name: english("chat.reference.open.quote", { name: workspaceText }), exact: true })
    .click();
  await panel().getByText(workspaceText).waitFor({ timeout: UI_WAIT_MS });
  report.quote = {
    absolutePath: decodeURIComponent(quoteId ?? "").includes(workspaceFile),
    reopened: true,
  };
  await shot("quote-reopened");

  // 4. A file that the agent read outside its workspace in the channel opens from a link with its name only.
  if (workspaceAccessEnforced(agent)) {
    report.outside = { skipped: "workspace access" };
  } else {
    mkdirSync(join(OUT, `outside-${id}`), { recursive: true });
    writeFileSync(outsideFile, `# ${outsideText}\n`);
    await client.send(
      channel.id,
      [
        `Read the file ${outsideFile} with one tool call. Then reply with exactly the next line and nothing else.`,
        `[outside spec](${outsideName})`,
      ].join("\n"),
      agent.id,
    );
    const outsideLink = () =>
      conversation().getByRole("button", {
        name: english("chat.file.openWorkspace", { name: outsideName }),
        exact: true,
      });
    await outsideLink().first().waitFor({ timeout: WAIT_MS });
    await outsideLink().first().click();
    await panel().getByText(outsideText).waitFor({ timeout: UI_WAIT_MS });
    report.outside = { opened: true };
    await shot("outside-preview");
  }

  // 5. In the agent's own chat, the person's message links both files, and both still open.
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(agent.name)},`) })
    .first()
    .click();
  await client.sendToAgent(
    agent.id,
    `Reply with the single word ready. Do not use tools. [workspace spec](${workspaceName}) [shared spec](~/OpenBot/Shared/${sharedName})`,
  );
  await workspaceLink().last().click({ timeout: UI_WAIT_MS });
  await panel().getByText(workspaceText).waitFor({ timeout: UI_WAIT_MS });
  await sharedLink().last().click({ timeout: UI_WAIT_MS });
  await panel().getByText(sharedText).waitFor({ timeout: UI_WAIT_MS });
  report.directChat = {
    sharedOpened: true,
    workspaceOpened: true,
    workspaceLinksInSharedFile: await panelWorkspaceLink().count(),
  };
  await shot("direct-chat-preview");

  assert.equal(linkInOwnMessage, 0, "A person's message in a channel must not link a workspace path.");
  assert.equal(workspaceLinksInSharedFile, 0, "A shared file in a channel must not link a workspace path.");
  assert.equal(report.directChat?.workspaceLinksInSharedFile, 1, "A shared file in a direct chat links it.");
  assert.equal(report.quote?.absolutePath, true, "A channel quote of a workspace file must name its absolute path.");
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} catch (error) {
  await shot("failure").catch(() => undefined);
  const channelPage = report.channelId ? await client.read(report.channelId).catch(() => null) : null;
  report.agentReplies = channelPage?.messages
    .filter((entry) => entry.author.kind === "agent")
    .map((entry) => entry.message.text);
  report.taskStates = channelPage?.tasks.map((task) => task.state);
  throw error;
} finally {
  await client.cleanup();
  rmSync(sharedFile, { force: true });
  if (workspaceFile) rmSync(workspaceFile, { force: true });
  rmSync(join(OUT, `outside-${id}`), { recursive: true, force: true });
  writeReport("channel-file-link-e2e", report);
  await session.close();
}
