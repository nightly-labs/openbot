import { ProviderLogo, type ProviderLogoVariant } from "@openbot/brand";
import {
  BellOff,
  buttonVariants,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  DropdownMenu,
  FolderInput,
  Heading,
  Pencil,
  Pin,
  Trash2,
} from "@openbot/ui";
import { SwapLabel } from "@openbot/ui/components/SwapLabel";
import { createSignal, For, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import "./DropdownMenu.css";

// The menu look, after https://kobra.systems/components/dropdown-menu. The model select also shows
// parts that only this story draws: the avatar cluster on the trigger and drag to paint.
const meta = {
  title: "Foundations/Dropdown Menu",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

interface ModelOption {
  id: string;
  name: string;
  provider: ProviderLogoVariant;
  background: string;
  foreground?: string;
}

const MODELS: readonly ModelOption[] = [
  { id: "claude", name: "Claude Opus 5.5", provider: "claude", background: "var(--openbot-provider-claude)" },
  {
    id: "codex",
    name: "GPT-5.5 Codex",
    provider: "codex",
    background: "var(--openbot-text-primary)",
    foreground: "var(--openbot-bg-canvas)",
  },
  { id: "gemini", name: "Gemini 3 Pro", provider: "antigravity", background: "var(--openbot-provider-antigravity)" },
  { id: "grok", name: "Grok 5", provider: "grok", background: "var(--openbot-bg-sheet)" },
];

function ModelAvatar(props: { model: ModelOption }) {
  return (
    <span
      class="dropdown-story-avatar"
      style={{ "--story-avatar-bg": props.model.background, "--story-avatar-fg": props.model.foreground }}
    >
      <ProviderLogo provider={props.model.provider} />
    </span>
  );
}

const MODEL_ORDER = MODELS.map((model) => model.id);

// The trigger cluster: one avatar fills the 24px box, two overlap on the diagonal, and three or
// four share a 2 by 2 grid. Each avatar moves to its new place instead of popping in.
const CLUSTER_SLOTS: Record<number, readonly (readonly [x: number, y: number, size: number])[]> = {
  1: [[0, 0, 24]],
  2: [
    [1, 1, 14],
    [9, 9, 14],
  ],
  3: [
    [0, 0, 11.5],
    [12.5, 0, 11.5],
    [0, 12.5, 11.5],
  ],
  4: [
    [0, 0, 11.5],
    [12.5, 0, 11.5],
    [0, 12.5, 11.5],
    [12.5, 12.5, 11.5],
  ],
};

function ModelCluster(props: { selected: readonly ModelOption[] }) {
  const slots = () => CLUSTER_SLOTS[props.selected.length] ?? [];
  // A hidden avatar stays where it was, so it fades out in place.
  const lastSlot = new Map<string, readonly [number, number, number]>();
  const slotOf = (model: ModelOption) => {
    const index = props.selected.indexOf(model);
    const slot = slots()[index];
    if (slot) lastSlot.set(model.id, slot);
    return slot ?? lastSlot.get(model.id) ?? [0, 0, 24];
  };
  return (
    <span class="dropdown-story-cluster" aria-hidden="true" data-empty={props.selected.length === 0 ? "" : undefined}>
      <For each={MODELS}>
        {(model) => (
          <span
            class="dropdown-story-avatar"
            data-hidden={props.selected.includes(model) ? undefined : ""}
            style={{
              "--story-avatar-bg": model.background,
              "--story-avatar-fg": model.foreground,
              left: `${slotOf(model)[0]}px`,
              top: `${slotOf(model)[1]}px`,
              width: `${slotOf(model)[2]}px`,
              height: `${slotOf(model)[2]}px`,
              "z-index": props.selected.length === 2 && props.selected[0] === model ? 1 : undefined,
            }}
          >
            <ProviderLogo provider={model.provider} />
          </span>
        )}
      </For>
      <span class="dropdown-story-cluster-spare" data-hidden={props.selected.length === 3 ? undefined : ""} />
    </span>
  );
}

interface PaintStroke {
  pointerId: number;
  from: string;
  origin: HTMLElement;
  value: boolean;
  before: ReadonlySet<string>;
  painting: boolean;
}

function ModelSelectMenu() {
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set(["claude", "codex"]));
  const [effort, setEffort] = createSignal("Medium");
  const [painting, setPainting] = createSignal(false);
  const selectedModels = () => MODELS.filter((model) => selected().has(model.id));
  const label = () => {
    const models = selectedModels();
    if (models.length === MODELS.length) return "All models";
    if (models.length === 0) return "No models";
    if (models.length === 1) return models[0]?.name ?? "";
    return `${models.length} models`;
  };
  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected());
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  // Drag to paint: press a row and drag across the others to give them all the new value
  // of the first row. The row that started the stroke does not toggle again on release.
  let stroke: PaintStroke | undefined;
  let skipChange = false;
  const startStroke = (event: PointerEvent & { currentTarget: HTMLElement }, id: string) => {
    if (event.button !== 0 || stroke?.painting) return;
    stroke = {
      pointerId: event.pointerId,
      from: id,
      origin: event.currentTarget,
      value: !selected().has(id),
      before: selected(),
      painting: false,
    };
  };
  const moveStroke = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    const row = event.currentTarget.getBoundingClientRect();
    const over = document
      .elementFromPoint(row.left + row.width / 2, event.clientY)
      ?.closest("[data-model-id]")
      ?.getAttribute("data-model-id");
    if (!over) return;
    if (!stroke.painting) {
      if (over === stroke.from) return;
      stroke.painting = true;
      stroke.origin.setPointerCapture(event.pointerId);
      setPainting(true);
    }
    const start = MODEL_ORDER.indexOf(stroke.from);
    const end = MODEL_ORDER.indexOf(over);
    const next = new Set(stroke.before);
    for (const id of MODEL_ORDER.slice(Math.min(start, end), Math.max(start, end) + 1)) {
      if (stroke.value) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };
  const endStroke = (event: PointerEvent) => {
    if (stroke?.pointerId !== event.pointerId) return;
    if (stroke.painting) {
      skipChange = true;
      // The release may land outside a row, so no change follows it.
      setTimeout(() => {
        skipChange = false;
      });
    }
    stroke = undefined;
    setPainting(false);
  };

  return (
    <DropdownMenu.Root defaultOpen>
      <DropdownMenu.Trigger class={`${buttonVariants({ variant: "outline", size: "lg" })} dropdown-story-trigger`}>
        <ModelCluster selected={selectedModels()} />
        <SwapLabel text={label()} />
        <ChevronsUpDown class="ui-menu-trailing" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content data-painting={painting() ? "" : undefined}>
          <For each={MODELS}>
            {(model) => (
              <DropdownMenu.CheckboxItem
                data-model-id={model.id}
                checked={selected().has(model.id)}
                onChange={(checked) => {
                  if (skipChange) {
                    skipChange = false;
                    return;
                  }
                  toggle(model.id, checked);
                }}
                onPointerDown={(event) => startStroke(event, model.id)}
                onPointerMove={moveStroke}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                onLostPointerCapture={endStroke}
                closeOnSelect={false}
              >
                <span class="ui-menu-check" data-checked={selected().has(model.id) ? "" : undefined}>
                  <Show when={selected().has(model.id)}>
                    <Check aria-hidden="true" />
                  </Show>
                </span>
                <ModelAvatar model={model} />
                {model.name}
              </DropdownMenu.CheckboxItem>
            )}
          </For>
          <DropdownMenu.Separator />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              Open weights
              <ChevronRight class="ui-menu-trailing" aria-hidden="true" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent class="ui-action-menu">
                <DropdownMenu.Item>OpenCode</DropdownMenu.Item>
                <DropdownMenu.Item>Llama 5</DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              Media
              <ChevronRight class="ui-menu-trailing" aria-hidden="true" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent class="ui-action-menu">
                <DropdownMenu.Item>Imagen 4</DropdownMenu.Item>
                <DropdownMenu.Item>Veo 3</DropdownMenu.Item>
                <DropdownMenu.Item>Sora 2</DropdownMenu.Item>
                <DropdownMenu.Item>Speech</DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              Reasoning effort
              <ChevronRight class="ui-menu-trailing" aria-hidden="true" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent class="ui-action-menu">
                <DropdownMenu.RadioGroup value={effort()} onChange={setEffort}>
                  <For each={["Low", "Medium", "High"]}>
                    {(level) => (
                      <DropdownMenu.RadioItem value={level}>
                        {level}
                        <Show when={effort() === level}>
                          <Check class="ui-menu-trailing" aria-hidden="true" />
                        </Show>
                      </DropdownMenu.RadioItem>
                    )}
                  </For>
                </DropdownMenu.RadioGroup>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export const ModelSelect: Story = {
  render: () => (
    <main class="foundation-story foundation-interaction-stage">
      <Heading as="h1" size="lg">
        Model select
      </Heading>
      <ModelSelectMenu />
    </main>
  ),
};

export const AgentActions: Story = {
  render: () => (
    <main class="foundation-story foundation-interaction-stage">
      <Heading as="h1" size="lg">
        Agent actions
      </Heading>
      <DropdownMenu.Root defaultOpen>
        <DropdownMenu.Trigger class={buttonVariants({ variant: "outline", size: "sm" })}>
          Researcher
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <div class="ui-menu-label">Researcher</div>
            <DropdownMenu.Item>
              <Pencil aria-hidden="true" />
              Rename
              <span class="ui-menu-trailing">⌘R</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item>
              <Pin aria-hidden="true" />
              Pin to sidebar
            </DropdownMenu.Item>
            <DropdownMenu.Item disabled>
              <Copy aria-hidden="true" />
              Duplicate
            </DropdownMenu.Item>
            <DropdownMenu.Item>
              <BellOff aria-hidden="true" />
              Mute
              <span class="ui-menu-trailing">⌘M</span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item>
              <FolderInput aria-hidden="true" />
              Move to
            </DropdownMenu.Item>
            <DropdownMenu.Item class="ui-action-menu-danger">
              <Trash2 aria-hidden="true" />
              Delete
              <span class="ui-menu-trailing">⌘⌫</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </main>
  ),
};
