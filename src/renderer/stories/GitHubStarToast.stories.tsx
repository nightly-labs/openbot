import { Button, Toaster, toast } from "@openbot/ui";
import { GitHubStarToast } from "@openbot/ui/features/github-star/GitHubStarToast";
import { createSignal, onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Conversation/GitHub star toast",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const TOAST_ID = "story-github-star";

function raise(): void {
  const [thanked, setThanked] = createSignal(false);
  toast(
    () => (
      <GitHubStarToast thanked={thanked()} onStar={() => setThanked(true)} onClose={() => toast.dismiss(TOAST_ID)} />
    ),
    {
      id: TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      unstyled: true,
      closeButton: false,
      class: "github-star-toast-host",
    },
  );
}

/** The one-time request after the third message to an agent. Star on GitHub changes it to a thank-you. */
export const AfterThirdMessage: Story = {
  render: () => {
    onCleanup(() => toast.dismiss(TOAST_ID));
    return (
      <main class="foundation-story">
        <Button type="button" onClick={raise}>
          Send the third message
        </Button>
        <Toaster />
      </main>
    );
  },
};
