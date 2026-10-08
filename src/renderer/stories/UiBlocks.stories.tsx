import type {
  UiBlockResponse,
  UiBlockSpec,
  UiBlockState,
  UiChoiceBlock as UiChoiceSpec,
  UiConfirmBlock as UiConfirmSpec,
  UiFormBlock as UiFormSpec,
  UiQuickRepliesBlock as UiQuickRepliesSpec,
} from "@openbot/contracts/ui-blocks";
import { uiBlockOutcomeText } from "@openbot/contracts/ui-blocks";
import { UiChoiceBlock } from "@openbot/ui/features/conversation/ui-blocks/UiChoiceBlock";
import { UiConfirmBlock } from "@openbot/ui/features/conversation/ui-blocks/UiConfirmBlock";
import { UiFormBlock } from "@openbot/ui/features/conversation/ui-blocks/UiFormBlock";
import { UiQuickReplies } from "@openbot/ui/features/conversation/ui-blocks/UiQuickReplies";
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
      />
    );
  };
}

const LiveConfirm = live<UiConfirmSpec>(UiConfirmBlock);
const LiveChoice = live<UiChoiceSpec>(UiChoiceBlock);
const LiveQuick = live<UiQuickRepliesSpec>(UiQuickReplies);
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

export const Narrow: Story = {
  render: (args) => (
    <div style={{ "max-width": "360px" }}>
      <LiveForm spec={formSpec} onRespond={args.onRespond} />
    </div>
  ),
};
