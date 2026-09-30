import type { ServerSummary } from "@openbot/contracts/ipc";
import { Heading, Text } from "@openbot/ui";
import { AddServerDialog, type HostedServerSetupStatus } from "@openbot/ui/features/servers/AddServerDialog";
import { hostedServerPlansFromCatalog } from "@openbot/ui/features/servers/HostedServerPricing";
import { ServerRail } from "@openbot/ui/features/servers/ServerRail";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MOCK_HOSTED_SERVER_CATALOG } from "../src/preview/mock-hosted-servers";
import { STORY_SERVERS } from "./fixtures";

/** The plans of the preview catalog, which has the Stripe sandbox prices. */
const PLANS = hostedServerPlansFromCatalog(MOCK_HOSTED_SERVER_CATALOG);

/** How long each fake setup step takes, so the progress is easy to watch. */
const STEP_MS = 5_000;

interface FlowProps {
  /** Open the add-server dialog when the story loads. */
  startOpen?: boolean;
  /** The fake setup stops with an error at the "Start OpenBot" step on the first try. */
  failFirstTry?: boolean;
  /** The account has this many servers, the maximum, so the plans are disabled. */
  serverLimit?: number;
}

/**
 * The server rail with a working plus button. Create a hosted server: the fake payment page
 * "confirms" after one step, then the setup runs and the new server is added to the rail. Nothing
 * leaves the browser: every call is fake.
 */
function AddServerFlow(props: FlowProps) {
  const [servers, setServers] = createSignal<ServerSummary[]>(STORY_SERVERS);
  const [addOpen, setAddOpen] = createSignal(props.startOpen ?? false);
  const [contactNote, setContactNote] = createSignal(false);
  const [joinNote, setJoinNote] = createSignal(false);
  const [manageNote, setManageNote] = createSignal(false);
  const [setupStatus, setSetupStatus] = createSignal<HostedServerSetupStatus | null>(null);
  const [pending, setPending] = createSignal({ id: "", name: "" });
  let attempts = 0;
  let timers: number[] = [];

  const activeServer = createMemo(() => servers().find((server) => server.active) ?? servers()[0]);

  onCleanup(clearTimers);

  function clearTimers(): void {
    for (const timer of timers) window.clearTimeout(timer);
    timers = [];
  }

  function runSetup(): void {
    clearTimers();
    attempts += 1;
    const fail = props.failFirstTry && attempts === 1;
    setSetupStatus(attempts === 1 ? "payment" : "creating");
    const steps: HostedServerSetupStatus[] = fail ? ["starting", "error"] : ["starting", "connecting", "ready"];
    if (attempts === 1) steps.unshift("creating");
    timers = steps.map((status, index) => window.setTimeout(() => setSetupStatus(status), STEP_MS * (index + 1)));
  }

  function openAdd(): void {
    clearTimers();
    attempts = 0;
    setSetupStatus(null);
    setAddOpen(true);
  }

  function addServer(server: Omit<ServerSummary, "active">): void {
    setServers((current) => [...current.map((entry) => ({ ...entry, active: false })), { ...server, active: true }]);
  }

  return (
    <>
      <ServerRail
        servers={servers()}
        onSelect={(serverId) =>
          setServers((current) => current.map((server) => ({ ...server, active: server.id === serverId })))
        }
        onReorder={(serverIds) =>
          setServers((current) => [
            ...current.filter((server) => server.kind === "local"),
            ...serverIds.flatMap((id) => current.filter((server) => server.id === id)),
          ])
        }
        onAdd={openAdd}
        addCreatesServer
      />
      <main class="foundation-story">
        <Heading as="h1" size="lg">
          {activeServer()?.name}
        </Heading>
        <Text tone="muted">Click the plus button in the server rail to add a server.</Text>
        <Show when={contactNote()}>
          <Text tone="muted">"Contact us" was clicked. The app opens an email to hello@openbot.run here.</Text>
        </Show>
        <Show when={manageNote()}>
          <Text tone="muted">"Manage servers" was clicked. The app opens the list of hosted servers here.</Text>
        </Show>
        <Show when={joinNote()}>
          <Text tone="muted">"Join a server" was clicked. The app opens the invite dialog here.</Text>
        </Show>
      </main>

      <Show when={addOpen()}>
        <AddServerDialog
          plans={PLANS}
          recommendedPlan="standard"
          setupStatus={setupStatus()}
          serverLimit={props.serverLimit}
          onManageServers={() => setManageNote(true)}
          onClose={() => setAddOpen(false)}
          onContactUs={() => setContactNote(true)}
          onJoinWithInvite={() => {
            setAddOpen(false);
            setJoinNote(true);
          }}
          onCreate={async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 700));
            const count = servers().filter((server) => server.id.startsWith("hosted-")).length;
            const id = `hosted-${count + 1}`;
            const name = count === 0 ? "Cloud server" : `Cloud server ${count + 1}`;
            setPending({ id, name });
            runSetup();
            return { serverId: id, name };
          }}
          onRetry={runSetup}
          onOpenPayment={() => new Promise((resolve) => window.setTimeout(resolve, 700))}
          onOpenServer={() =>
            addServer({
              ...serverDefaults(),
              id: pending().id,
              name: pending().name,
              apiUrl: `https://${pending().id}.hosted.openbot.run`,
              role: "owner",
            })
          }
        />
      </Show>
    </>
  );
}

function serverDefaults(): Omit<ServerSummary, "active" | "id" | "name" | "apiUrl" | "role"> {
  return {
    logoUrl: null,
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
    kind: "remote",
    state: "online",
    remoteDesktopAvailable: true,
  };
}

const meta = {
  title: "Team/Add Server Flow",
  decorators: [(Story) => <div class="app-frame app-frame-edge app-frame-with-server-rail">{Story()}</div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        addServerNarrow: { name: "Add server — 360 × 720", styles: { width: "360px", height: "720px" } },
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click the plus button, then create a hosted server. */
export const ClickPlus: Story = {
  render: () => <AddServerFlow />,
};

/** The dialog is open when the story loads. */
export const DialogOpen: Story = {
  render: () => <AddServerFlow startOpen />,
};

/** The first setup stops at "Start OpenBot". "Try again" then succeeds. */
export const SetupFails: Story = {
  render: () => <AddServerFlow startOpen failFirstTry />,
};

/** The account has the maximum number of servers. "Manage servers" closes the dialog. */
export const ServerLimit: Story = {
  render: () => <AddServerFlow startOpen serverLimit={3} />,
};

/** A narrow window: the plan cards stack. */
export const Narrow: Story = {
  globals: { viewport: { value: "addServerNarrow", isRotated: false } },
  render: () => <AddServerFlow startOpen />,
};
