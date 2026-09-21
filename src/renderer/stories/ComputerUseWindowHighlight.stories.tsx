import type { JSX } from "@solidjs/web";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ComputerUseAgentCursor } from "../src/features/computer-use/ComputerUseAgentCursor";
import { ComputerUseWindowHighlight } from "../src/features/computer-use/ComputerUseWindowHighlight";

/**
 * A stand-in for the application window under the tint. The real one is another program's window
 * on the desktop, which a story cannot hold, so this draws the parts the tint has to stay readable
 * over: a title bar, text, and a field.
 */
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

/** The window the agent holds: one even rim the whole way round, and nothing that moves. */
export const Highlighted: Story = {
  render: () => (
    <main class="foundation-story">
      <MockWindow>
        <ComputerUseWindowHighlight windowTitle="Notes" />
      </MockWindow>
    </main>
  ),
};

/** The window under it is what sets the radius, which a square-cornered window proves. */
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

/** Most windows an agent drives are dark, where the same rim has to read without glaring. */
export const DarkWindow: Story = {
  render: () => (
    <main class="foundation-story">
      <MockWindow dark title="Terminal">
        <ComputerUseWindowHighlight windowTitle="Terminal" />
      </MockWindow>
    </main>
  ),
};

/**
 * The cursor OpenBot draws itself, which it does on every desktop of more than one display. The
 * story places it over the field, where an agent that types there would have clicked first.
 */
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

/** The same cursor on a dark window, where the white outline is what keeps the dart readable. */
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

/**
 * A window in front of the one the agent works in, which the rim gives way to.
 *
 * The overlay floats over the whole desktop, so without this the rim would be drawn over the window
 * in front and read as a rim around that one. The story covers the lower right corner.
 */
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

/** Side by side, which is the only way to judge whether the rim is light enough. */
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
