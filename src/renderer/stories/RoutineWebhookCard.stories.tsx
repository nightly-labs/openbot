import type { EventFilterDraft } from "@openbot/contracts/event-filter-value";
import { RoutineWebhookCard, type RoutineWebhookCardProps } from "@openbot/ui/features/conversation/RoutineWebhookCard";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * The chat record of a webhook routine an agent created or changed. The agent never gets the signing
 * secret, so the person makes one on the card, and can change which events start the routine. In the
 * app, `RoutineWebhookChatCard` asks the host for the secret and saves the events.
 */

const STORY_SECRET = "whsec_storybook-example-not-a-real-secret";

/** Holds the secret and the events, so Regenerate and an edit show the way the app does. */
function CardStage(props: RoutineWebhookCardProps) {
  const [secret, setSecret] = createSignal<string | null>(null);
  const [eventType, setEventType] = createSignal(() => props.eventType);
  const [filters, setFilters] = createSignal<EventFilterDraft[]>(() => props.filters);
  return (
    <RoutineWebhookCard
      {...props}
      secret={secret() ?? props.secret}
      eventType={eventType()}
      filters={filters()}
      onEventTypeChange={(next) => {
        setEventType(next);
        props.onEventTypeChange(next);
      }}
      onFiltersChange={(next) => {
        setFilters(next);
        props.onFiltersChange(next);
      }}
      onSecretDismiss={() => {
        setSecret(null);
        props.onSecretDismiss();
      }}
      onRegenerateSecret={async () => {
        await props.onRegenerateSecret();
        setSecret(STORY_SECRET);
      }}
    />
  );
}

const meta = {
  title: "Routines/Webhook card",
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <CardStage {...args} />
    </main>
  ),
  args: {
    routineName: "Triage new GitHub issues",
    action: "created",
    url: "https://signal.openbot.run/v1/webhooks/0f3c9d2e-4b1a-4c55-9a87-2f6d1e0b7c34",
    connected: true,
    secret: null,
    eventType: "",
    filters: [],
    state: "idle",
    onEventTypeChange: fn(),
    onFiltersChange: fn(),
    onSave: fn(),
    onSecretDismiss: fn(),
    onRegenerateSecret: fn(async () => undefined),
    onOpenRoutine: fn(),
  },
  argTypes: {
    action: { control: "inline-radio", options: ["created", "updated"] },
    state: { control: "select", options: ["idle", "changed", "saving", "saved", "error"] },
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<RoutineWebhookCardProps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Created: Story = {};

export const SecretShown: Story = {
  args: { secret: STORY_SECRET },
};

export const UpdatedWithFilters: Story = {
  args: {
    action: "updated",
    eventType: "issues.opened",
    filters: [{ pointer: "/repository/name", value: "openbot" }],
  },
};

export const ChangedNotSaved: Story = {
  args: {
    eventType: "issues.opened",
    filters: [{ pointer: "/label", value: "bug" }],
    state: "changed",
  },
};

export const UrlPending: Story = {
  args: { url: null, connected: null },
};

export const RelayOffline: Story = {
  args: { connected: false },
};
