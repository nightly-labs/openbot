import { Button } from "@openbot/ui";
import { WhatsNewDialog } from "@openbot/ui/features/updates/WhatsNewDialog";
import type { WhatsNewNotes, WhatsNewRelease } from "@openbot/ui/features/updates/whats-new";
import { createSignal, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

// The notes are real entries from CHANGELOG.md, shortened as an editor would for the dialog.

const RELEASE_0_23: WhatsNewRelease = {
  version: "0.23.0",
  date: "2026-09-27",
  notices: [],
  groups: [
    {
      type: "added",
      items: [
        "Show the plan of an agent as a task list in the chat. The list changes while the agent works and stays in the history.",
        'Show a "Waiting for replies" block above the message box when an agent asks its teammates. Each row shows a teammate and its status.',
        "Let an agent create a new agent with the provider, model and reasoning effort that you ask for.",
        "Show the images of an agent message in a gallery. Click an image to open it in a viewer, go to the next image or download it.",
      ],
    },
    {
      type: "changed",
      items: [
        "Let an agent read all the replies of its teammates in one turn. Before, it answered you again after each teammate.",
        "Move the AI providers to their own Settings tab, after General.",
        "Connect to joined servers again at once when the computer wakes from sleep.",
      ],
    },
    {
      type: "fixed",
      items: [
        "Keep a question from an OpenCode agent open until you answer it. Before, the question failed after 60 seconds.",
        "Show the cost of the default Codex model in agent usage.",
        "Show the new server logo in server settings before you save it.",
        "Keep the focus in the server name menu. A click outside the menu now only closes it.",
        "Remove the incomplete copy when a copy of a local agent fails.",
      ],
    },
  ],
};

const RELEASE_0_22: WhatsNewRelease = {
  version: "0.22.0",
  date: "2026-09-26",
  notices: [
    "Workspace only is now enforced. On Windows and Linux, a Grok, OpenCode or Gemini agent with Workspace only does not start. To use it, select Full access in the agent settings.",
  ],
  groups: [
    {
      type: "added",
      items: [
        "Use Gemini with a Google AI Pro or Ultra plan. OpenBot signs in through your browser.",
        "Turn Computer Use off for one agent in its settings.",
        "Select the interface language on mobile.",
      ],
    },
    {
      type: "changed",
      items: ["Show more of the interface in French and Japanese."],
    },
    {
      type: "fixed",
      items: [
        "End the turns of a provider client that stopped. Before, these turns stayed in progress until OpenBot restarted.",
        "Keep queued messages when a file delete fails.",
      ],
    },
  ],
};

const FIXES_ONLY: WhatsNewRelease = {
  version: "0.23.1",
  date: "2026-09-28",
  notices: [],
  groups: [
    {
      type: "fixed",
      items: [
        "Show the highlight of the selected server across the full row in the mobile server list.",
        "Keep the reason when an agent turn fails. The queue now shows the provider error after a restart.",
      ],
    },
  ],
};

const EMPTY_RELEASE: WhatsNewRelease = { version: "0.23.2", date: "2026-09-29", notices: [], groups: [] };

const args: Parameters<typeof WhatsNewDialog>[0] = {
  open: true,
  onOpenChange: fn(),
  version: "0.23.0",
  previousVersion: "0.22.0",
  notes: { status: "ready", releases: [RELEASE_0_23] },
  onRetry: fn(),
  onOpenChangelog: fn(),
};

const meta = {
  title: "Updates/WhatsNewDialog",
  component: WhatsNewDialog,
  args,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        whatsNewNarrow: { name: "What's new — 390 × 720", styles: { width: "390px", height: "720px" } },
      },
    },
  },
} satisfies Meta<typeof WhatsNewDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first start after an update from the version before. */
export const Default: Story = {};

/** An update that skipped a version: the notes of both show as one list, with the step to do first. */
export const SkippedVersions: Story = {
  args: {
    previousVersion: "0.21.2",
    notes: { status: "ready", releases: [RELEASE_0_23, RELEASE_0_22] },
  },
};

/** Three fixes or fewer stay open. */
export const FixesOnly: Story = {
  args: { version: "0.23.1", previousVersion: "0.23.0", notes: { status: "ready", releases: [FIXES_ONLY] } },
};

/** Opened again from Settings for a version with nothing to show. After an update, it does not open. */
export const NothingToShow: Story = {
  args: { version: "0.23.2", previousVersion: null, notes: { status: "ready", releases: [EMPTY_RELEASE] } },
};

export const Loading: Story = { args: { notes: { status: "loading" } } };

export const LoadFailed: Story = { args: { notes: { status: "failed" } } };

export const Narrow: Story = {
  args: SkippedVersions.args,
  globals: { viewport: "whatsNewNarrow" },
};

/** Retry loads the notes, and the dialog opens again after it closes. */
export const Playground: Story = {
  render: (props) => {
    const [open, setOpen] = createSignal(true);
    const [notes, setNotes] = createSignal<WhatsNewNotes>({ status: "failed" });
    function retry(): void {
      setNotes({ status: "loading" });
      window.setTimeout(() => setNotes({ status: "ready", releases: [RELEASE_0_23, RELEASE_0_22] }), 800);
    }
    return (
      <main class="foundation-story">
        <Show when={!open()}>
          <Button type="button" onClick={() => setOpen(true)}>
            What's new
          </Button>
        </Show>
        <WhatsNewDialog {...props} open={open()} onOpenChange={setOpen} notes={notes()} onRetry={retry} />
      </main>
    );
  },
  args: { previousVersion: "0.21.2" },
};
