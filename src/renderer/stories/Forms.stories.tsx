import { Button, Field, Heading, Input, NativeSelect, Textarea } from "@openbot/ui";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Foundations/Forms",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {
  render: () => (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Form controls
      </Heading>
      <form class="foundation-form">
        <Field
          label="Agent name"
          htmlFor="foundation-name"
          description="Visible to everyone in the workspace."
          required
        >
          <Input id="foundation-name" name="name" placeholder="Research agent" required />
        </Field>
        <Field label="Provider" htmlFor="foundation-provider">
          <NativeSelect id="foundation-provider" name="provider">
            <option>OpenAI</option>
            <option>Anthropic</option>
          </NativeSelect>
        </Field>
        <Field label="Instructions" htmlFor="foundation-instructions">
          <Textarea id="foundation-instructions" name="instructions" placeholder="Describe the agent’s role…" />
        </Field>
        <Field label="Invalid example" htmlFor="foundation-invalid" error="This field needs attention.">
          <Input id="foundation-invalid" invalid value="Invalid value" />
        </Field>
        <Button type="submit" variant="default">
          Save agent
        </Button>
      </form>
    </main>
  ),
};

export const ControlledTyping: Story = {
  render: () => {
    const [name, setName] = createSignal("");
    const [description, setDescription] = createSignal("");
    return (
      <main class="foundation-story">
        <Heading as="h1" size="lg">
          Controlled text fields
        </Heading>
        <Field label="Agent name" htmlFor="controlled-agent-name">
          <Input id="controlled-agent-name" value={name()} onValueChange={setName} />
        </Field>
        <Field label="Description" htmlFor="controlled-agent-description">
          <Textarea id="controlled-agent-description" value={description()} onValueChange={setDescription} />
        </Field>
      </main>
    );
  },
};
