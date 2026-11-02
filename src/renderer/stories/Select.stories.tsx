import { Heading, SearchSelect, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const options = ["Low", "Medium", "High", "Extra high"];

const meta = {
  title: "Foundations/Select",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function ReasoningSelect(props: { size?: "sm" | "md" | undefined; disabled?: boolean | undefined }) {
  const [value, setValue] = createSignal("Medium");
  return (
    <Select<string>
      options={options}
      value={value()}
      disabled={props.disabled === true}
      onChange={(next) => next && setValue(next)}
      itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue}</SelectItem>}
    >
      <SelectTrigger size={props.size} aria-label="Reasoning level">
        <SelectValue<string>>{(state) => state.selectedOption()}</SelectValue>
      </SelectTrigger>
      <SelectContent />
    </Select>
  );
}

export const Gallery: Story = {
  render: () => (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Selects
      </Heading>
      <div class="foundation-story-stack">
        <ReasoningSelect />
        <ReasoningSelect size="sm" />
        <ReasoningSelect disabled />
      </div>
    </main>
  ),
};

// V8 lists canonical zones only, as the Timezone setting does.
const zones = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];

function TimezoneSelect() {
  const [value, setValue] = createSignal("Europe/Warsaw");
  return (
    <div class="foundation-story-stack">
      <span id="story-timezone-label">Timezone</span>
      <SearchSelect<string>
        options={zones}
        value={value()}
        label={(zone) => zone.replaceAll("_", " ")}
        size="sm"
        aria-labelledby="story-timezone-label"
        onChange={setValue}
      />
    </div>
  );
}

export const Search: Story = {
  render: () => (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Select with search
      </Heading>
      <TimezoneSelect />
    </main>
  ),
};
