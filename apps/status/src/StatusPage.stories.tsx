import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { StatusPage } from "./StatusPage";
import { ALL_CLEAR_FIXTURE, FIXTURE_NOW, STATUS_FIXTURE } from "./status-fixture";

const meta = {
  title: "Status page",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenIncident: Story = { render: () => <StatusPage status={STATUS_FIXTURE} now={FIXTURE_NOW} /> };

export const AllClear: Story = { render: () => <StatusPage status={ALL_CLEAR_FIXTURE} now={FIXTURE_NOW} /> };
