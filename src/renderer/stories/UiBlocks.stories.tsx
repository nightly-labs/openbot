import type {
  UiBlockResponse,
  UiBlockSpec,
  UiBlockState,
  UiChoiceBlock as UiChoiceSpec,
  UiConfirmBlock as UiConfirmSpec,
  UiFormBlock as UiFormSpec,
  UiQuickRepliesBlock as UiQuickRepliesSpec,
} from "@openbot/contracts/ui-blocks";
import { UI_API_KEY_SCOPE_FIELD_ID, uiBlockOutcomeText } from "@openbot/contracts/ui-blocks";
import { UiChoiceBlock } from "@openbot/ui/features/conversation/ui-blocks/UiChoiceBlock";
import { UiConfirmBlock } from "@openbot/ui/features/conversation/ui-blocks/UiConfirmBlock";
import { UiFormBlock } from "@openbot/ui/features/conversation/ui-blocks/UiFormBlock";
import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const confirmSpec: UiConfirmSpec = {
  type: "confirm",
  title: "Send the letter to the building office?",
  fields: [
    { label: "To", value: "board@example.com" },
    {
      label: "From",
      select: "from",
      options: ["home@example.com", "work@example.com", "spare@example.com"],
    },
    { label: "Subject", value: "Flat 41: no heating on the riser" },
  ],
  preview:
    "Hello! Flat 41 (7th floor, section 1) is on the list of flats without heating. The radiators are in place, the thermostat is on 3 of 5, and there is no leak. Please check the riser and start the heating before Friday, 9 October.",
  actions: [
    { id: "send", label: "Send", style: "primary" },
    { id: "edit", label: "Edit" },
    { id: "cancel", label: "Do not send", style: "ghost" },
  ],
};

const dangerSpec: UiConfirmSpec = {
  type: "confirm",
  title: "Delete the staging database?",
  danger: true,
  confirmHold: 1200,
  fields: [
    { label: "Server", value: "staging-1" },
    { label: "Size", value: "14 GB, 212 tables" },
  ],
  actions: [
    { id: "delete", label: "Delete", style: "danger" },
    { id: "keep", label: "Keep it", style: "ghost" },
  ],
};

/** The plan card of `acknowledge_request`. The host presses Start when nobody answers in 10 s. */
const planSpec: UiConfirmSpec = {
  type: "confirm",
  title: "On it. This is my plan for the 502 on staging.",
  fields: [
    { label: "First", value: "Read the nginx and API logs on staging" },
    { label: "Then", value: "Fix the cause, for example restart the API container" },
  ],
  actions: [
    { id: "start", label: "Start", style: "primary" },
    { id: "alternative", label: "Only find the cause" },
    { id: "cancel", label: "Cancel", style: "ghost" },
  ],
};

const choiceSpec: UiChoiceSpec = {
  type: "choice",
  title: "Who should get the offer?",
  multiple: true,
  options: [
    { id: "active", label: "Bought in the last 30 days", meta: "1 284", selected: true },
    { id: "sleeping", label: "Sleeping for 90 days", meta: "3 102" },
    { id: "new", label: "New customers", meta: "2 040" },
  ],
  submit: "Create a draft",
};

const singleChoiceSpec: UiChoiceSpec = {
  type: "choice",
  title: "Which environment should I deploy to?",
  options: [
    { id: "staging", label: "Staging" },
    { id: "production", label: "Production", meta: "needs approval" },
  ],
};

// Agents no longer get quick replies; a stored or remote one shows as a choice.
const quickSpec: UiQuickRepliesSpec = {
  type: "quick_replies",
  title: "Found 3 new emails. One is important: an invoice for 2 490, due 12 October.",
  options: [
    { id: "show", label: "Show the email" },
    { id: "remind", label: "Remind me on 11 October" },
    { id: "task", label: "Add to tasks" },
    { id: "skip", label: "Not important" },
  ],
  allowText: true,
};

const formSpec: UiFormSpec = {
  type: "form",
  title: "New support ticket",
  fields: [
    { id: "subject", kind: "text", label: "Subject", required: true, placeholder: "What is wrong?" },
    { id: "kind", kind: "select", label: "Type", options: ["Bug", "Question", "Request"], required: true },
    { id: "due", kind: "date", label: "Due date" },
    {
      id: "level",
      kind: "segmented",
      label: "Priority",
      options: ["Low", "Normal", "High", "Critical"],
      value: "Normal",
    },
    { id: "note", kind: "textarea", label: "Details", placeholder: "Steps, links, what you tried" },
  ],
  submit: "Create ticket",
};

function answered(spec: UiBlockSpec, response: UiBlockResponse): UiBlockState {
  return { status: "answered", response, outcome: uiBlockOutcomeText(spec, response) };
}

interface LiveProps<Spec extends UiBlockSpec> {
  spec: Spec;
  state?: UiBlockState | undefined;
  onRespond: (response: UiBlockResponse) => void;
  disabled?: boolean;
  busy?: boolean;
  onSkip?: () => void;
}

/** Keeps the answer in the story, so a pending card freezes the way it does in the chat. */
function live<Spec extends UiBlockSpec>(
  Block: (props: LiveProps<Spec>) => JSX.Element,
): (props: LiveProps<Spec>) => JSX.Element {
  return (props) => {
    const [state, setState] = createSignal<UiBlockState | undefined>(props.state);
    return (
      <Block
        spec={props.spec}
        state={state()}
        disabled={props.disabled ?? false}
        busy={props.busy ?? false}
        onRespond={(response) => {
          props.onRespond(response);
          setState(answered(props.spec, response));
        }}
        onSkip={() => setState({ status: "closed" })}
      />
    );
  };
}

const LiveConfirm = live<UiConfirmSpec>(UiConfirmBlock);
const LiveChoice = live<UiChoiceSpec>(UiChoiceBlock);
const LiveQuick = live<UiQuickRepliesSpec>(UiChoiceBlock);
const LiveForm = live<UiFormSpec>(UiFormBlock);

const meta = {
  title: "Conversation/UiBlocks",
  args: { onRespond: fn() },
  decorators: [
    (Story) => (
      <main class="foundation-story">
        <Story />
      </main>
    ),
  ],
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<{ onRespond: (response: UiBlockResponse) => void }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmPending: Story = {
  render: (args) => <LiveConfirm spec={confirmSpec} onRespond={args.onRespond} />,
};

export const ConfirmDangerHold: Story = {
  render: (args) => <LiveConfirm spec={dangerSpec} onRespond={args.onRespond} />,
};

export const ConfirmAnswered: Story = {
  render: (args) => (
    <LiveConfirm
      spec={confirmSpec}
      state={answered(confirmSpec, { actionId: "send", values: { from: "work@example.com" } })}
      onRespond={args.onRespond}
    />
  ),
};

export const ConfirmExpired: Story = {
  render: (args) => <LiveConfirm spec={confirmSpec} state={{ status: "expired" }} onRespond={args.onRespond} />,
};

/** A draft taller than the preview box fades out at its end, and "Show all" under it opens the rest. */
export const ConfirmLongPreview: Story = {
  render: (args) => (
    <LiveConfirm
      spec={{
        ...confirmSpec,
        preview: Array.from({ length: 6 }, () => confirmSpec.preview).join("\n\n"),
      }}
      onRespond={args.onRespond}
    />
  ),
};

/** Skip and three long buttons do not fit on one row of a chat-wide card: the buttons fill both rows. */
export const ConfirmManyActions: Story = {
  render: (args) => (
    <div style={{ "max-width": "540px" }}>
      <LiveConfirm
        spec={{
          type: "confirm",
          title: "Publish the release post?",
          preview: "OpenBot 0.65 is out. Agents now ask questions in one prompt.",
          actions: [
            { id: "publish", label: "Publish on all channels", style: "primary" },
            { id: "schedule", label: "Schedule for tomorrow" },
            { id: "draft", label: "Save as a draft" },
          ],
        }}
        onRespond={args.onRespond}
      />
    </div>
  ),
};

/** Start counts down to the time the host answers. Cancel sits at the far end, and there is no Skip. */
export const PlanCountdown: Story = {
  render: (args) => (
    <LiveConfirm
      spec={planSpec}
      state={{ status: "pending", autoAnswer: { actionId: "start", at: new Date(Date.now() + 10_000).toISOString() } }}
      onRespond={args.onRespond}
    />
  ),
};

/** Nobody answered in time, so the host pressed Start. */
export const PlanAutoAnswered: Story = {
  render: (args) => (
    <LiveConfirm
      spec={planSpec}
      state={{
        ...answered(planSpec, { actionId: "start" }),
        autoAnswer: { actionId: "start", at: new Date().toISOString(), done: true },
      }}
      onRespond={args.onRespond}
    />
  ),
};

export const ChoicePending: Story = {
  render: (args) => <LiveChoice spec={choiceSpec} onRespond={args.onRespond} />,
};

export const ChoiceSingle: Story = {
  render: (args) => <LiveChoice spec={singleChoiceSpec} onRespond={args.onRespond} />,
};

export const ChoiceAnswered: Story = {
  render: (args) => (
    <LiveChoice
      spec={choiceSpec}
      state={answered(choiceSpec, { actionId: "submit", values: { selected: ["active", "new"] } })}
      onRespond={args.onRespond}
    />
  ),
};

export const QuickRepliesPending: Story = {
  render: (args) => <LiveQuick spec={quickSpec} onRespond={args.onRespond} />,
};

export const QuickRepliesAnswered: Story = {
  render: (args) => (
    <LiveQuick spec={quickSpec} state={answered(quickSpec, { actionId: "remind" })} onRespond={args.onRespond} />
  ),
};

export const FormPending: Story = {
  render: (args) => <LiveForm spec={formSpec} onRespond={args.onRespond} />,
};

export const FormAnswered: Story = {
  render: (args) => (
    <LiveForm
      spec={formSpec}
      state={answered(formSpec, {
        actionId: "submit",
        values: { subject: "Heating is off", kind: "Bug", due: "2026-10-09", level: "High", note: "Flat 41" },
      })}
      onRespond={args.onRespond}
    />
  ),
};

const vaultLoginSpec: UiFormSpec = {
  type: "form",
  title: "Test account for the Hetzner console (ask Sam for the password)",
  fields: [
    { id: "website", kind: "text", label: "Website", required: true, value: "console.hetzner.com" },
    { id: "username", kind: "text", label: "Username or email", value: "ada@example.com" },
    { id: "password", kind: "text", label: "Password", required: true, secret: true },
  ],
  submit: "Save to Vault",
};

/** A form that asks for a secret. Once answered, its values show as rows and the secret shows as hidden. */
export const SecretFormPending: Story = {
  render: (args) => <LiveForm spec={vaultLoginSpec} onRespond={args.onRespond} />,
};

export const SecretFormAnswered: Story = {
  render: (args) => (
    <LiveForm
      spec={vaultLoginSpec}
      state={answered(vaultLoginSpec, {
        actionId: "submit",
        values: { website: "console.hetzner.com", username: "ada@example.com" },
      })}
      onRespond={args.onRespond}
    />
  ),
};

/** The form of `request_api_key` with `vault` on a client that does not draw the Vault card, such as a joined server. */
const apiKeySpec: UiFormSpec = {
  type: "form",
  title: "PrivateMail app password for the CRM sync",
  fields: [
    { id: "key", kind: "text", label: "PRIVATEMAIL_APP_PASSWORD", required: true, secret: true },
    {
      id: UI_API_KEY_SCOPE_FIELD_ID,
      kind: "segmented",
      label: "Save for",
      options: ["All agents (Vault)", "Only this agent"],
      required: true,
      value: "All agents (Vault)",
    },
  ],
  submit: "Save securely",
};

export const ApiKeyPending: Story = {
  render: (args) => <LiveForm spec={apiKeySpec} onRespond={args.onRespond} />,
};

export const Narrow: Story = {
  render: (args) => (
    <div style={{ "max-width": "360px" }}>
      <LiveForm spec={formSpec} onRespond={args.onRespond} />
    </div>
  ),
};
