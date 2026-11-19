import type { JSX } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ComputerUseAgentCursor } from "../src/features/computer-use/ComputerUseAgentCursor";
import { ComputerUseWindowHighlight } from "../src/features/computer-use/ComputerUseWindowHighlight";

function MockWindow(props: { children?: JSX.Element; dark?: boolean; title?: string }) {
  return (
    <div class="highlight-story-desktop">
      <div class={`highlight-story-window${props.dark ? " highlight-story-window-dark" : ""}`}>
        <div class="highlight-story-titlebar">
          <span class="highlight-story-traffic" />
          <span class="highlight-story-traffic" />
          <span class="highlight-story-traffic" />
          <span class="highlight-story-window-title">{props.title ?? "Notes"}</span>
        </div>
        <div class="highlight-story-body">
          <p>Quarterly review</p>
          <p class="highlight-story-muted">
            The agent is filling this window in. The tint has to stay light enough to read every line of it, and the rim
            has to stay findable without looking for it.
          </p>
          <div class="highlight-story-field">Type the summary here</div>
        </div>
        {props.children}
      </div>
    </div>
  );
}

const meta = {
  title: "Computer Use/WindowHighlight",
  component: ComputerUseWindowHighlight,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof ComputerUseWindowHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Highlighted: Story = {
  render: () => (
    <main class="foundation-story">
      <MockWindow>
        <ComputerUseWindowHighlight windowTitle="Notes" />
      </MockWindow>
    </main>
  ),
};

export const SquareWindow: Story = {
  render: () => (
    <main class="foundation-story">
      <div class="highlight-story-square">
        <MockWindow title="Terminal">
          <ComputerUseWindowHighlight windowTitle="Terminal" cornerRadius={0} />
        </MockWindow>
      </div>
    </main>
  ),
};

export const DarkWindow: Story = {
  render: () => (
    <main class="foundation-story">
      <MockWindow dark title="Terminal">
        <ComputerUseWindowHighlight windowTitle="Terminal" />
      </MockWindow>
    </main>
  ),
};

export const WithAgentCursor: Story = {
  render: () => (
    <main class="foundation-story">
      <MockWindow>
        <ComputerUseWindowHighlight windowTitle="Notes" />
        <ComputerUseAgentCursor x={64} y={150} />
      </MockWindow>
    </main>
  ),
};

const CURSOR_STOPS = [
  { x: 64, y: 150 },
  { x: 300, y: 14 },
  { x: 120, y: 70 },
  { x: 360, y: 160 },
];

function TravellingCursor() {
  const [stop, setStop] = createSignal(0);
  onSettled(() => {
    const timer = setInterval(() => setStop((index) => (index + 1) % CURSOR_STOPS.length), 1500);
    return () => clearInterval(timer);
  });
  const point = () => CURSOR_STOPS[stop()] ?? { x: 64, y: 150 };
  return <ComputerUseAgentCursor x={point().x} y={point().y} />;
}

export const AgentCursorMoving: Story = {
  render: () => (
    <main class="foundation-story">
      <MockWindow>
        <ComputerUseWindowHighlight windowTitle="Notes" />
        <TravellingCursor />
      </MockWindow>
    </main>
  ),
};

export const AgentCursorOnDark: Story = {
  render: () => (
    <main class="foundation-story">
      <MockWindow dark title="Terminal">
        <ComputerUseWindowHighlight windowTitle="Terminal" />
        <ComputerUseAgentCursor x={64} y={150} />
      </MockWindow>
    </main>
  ),
};

export const CoveredByAnotherWindow: Story = {
  render: () => (
    <main class="foundation-story">
      <MockWindow>
        <ComputerUseWindowHighlight
          windowTitle="Notes"
          width={420}
          height={300}
          covered={[{ x: 210, y: 150, width: 260, height: 200 }]}
        />
        <div class="highlight-story-cover">Mail</div>
      </MockWindow>
    </main>
  ),
};

export const WithAndWithout: Story = {
  render: () => (
    <main class="foundation-story foundation-story-row">
      <MockWindow />
      <MockWindow>
        <ComputerUseWindowHighlight windowTitle="Notes" />
      </MockWindow>
    </main>
  ),
};
