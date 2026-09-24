import { Heading, SliderField } from "@openbot/ui";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Foundations/Slider",
  component: SliderField,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof SliderField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {
  args: {
    label: "Width",
    value: 100,
    minValue: 70,
    maxValue: 130,
    formatValue: (value: number) => `${value}%`,
  },
  render: () => {
    const [width, setWidth] = createSignal(100);
    const [saved, setSaved] = createSignal(100);
    return (
      <main class="foundation-story">
        <Heading as="h1" size="lg">
          Sliders
        </Heading>
        <div class="foundation-story-stack" style={{ "max-width": "440px" }}>
          <SliderField
            label="Width"
            description={`Saved: ${saved()}%`}
            value={width()}
            minValue={70}
            maxValue={130}
            step={5}
            formatValue={(value) => `${value}%`}
            onChange={setWidth}
            onChangeEnd={setSaved}
          />
          <SliderField label="Disabled" value={40} minValue={0} maxValue={100} disabled formatValue={String} />
        </div>
      </main>
    );
  },
};
