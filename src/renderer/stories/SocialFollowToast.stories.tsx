import { Button, Toaster, toast } from "@openbot/ui";
import { type SocialFollowStep, SocialFollowToast } from "@openbot/ui/features/social-follow/SocialFollowToast";
import { SOCIAL_NETWORKS } from "@openbot/ui/features/social-follow/social-networks";
import { createSignal, onCleanup, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Conversation/Social follow toast",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const TOAST_ID = "story-social-follow";

function raise(first: SocialFollowStep): void {
  const [step, setStep] = createSignal<SocialFollowStep>(first);
  const close = () => toast.dismiss(TOAST_ID);
  toast(
    () => (
      <SocialFollowToast
        step={step()}
        onPost={(network) =>
          setStep({ kind: "posted", network, result: network.compose === "copy" ? "copied" : network.compose })
        }
        onFollow={(network) => setStep({ kind: "followed", network })}
        onClose={close}
      />
    ),
    {
      id: TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      unstyled: true,
      closeButton: false,
      class: "social-follow-toast-host",
    },
  );
}

function ToastStory(props: { first: SocialFollowStep }) {
  onSettled(() => raise(props.first));
  onCleanup(() => toast.dismiss(TOAST_ID));
  return (
    <main class="foundation-story">
      <Button type="button" onClick={() => raise(props.first)}>
        Show the toast
      </Button>
      <Toaster />
    </main>
  );
}

/** After two days and ten messages, an agent's finished reply asks for a post. A network opens its post page. */
export const AskForPost: Story = { render: () => <ToastStory first={{ kind: "ask" }} /> };

/** Instagram has no post link: the toast copies a post, then asks for a follow. The post buttons stay. */
export const AfterCopiedPost: Story = {
  render: () => <ToastStory first={{ kind: "posted", network: SOCIAL_NETWORKS.instagram, result: "copied" }} />,
};

/** Reddit is a community: the follow button joins it. */
export const AfterCommunityPost: Story = {
  render: () => <ToastStory first={{ kind: "posted", network: SOCIAL_NETWORKS.reddit, result: "text" }} />,
};

/** The thanks after a follow. The app closes it after four seconds. */
export const AfterFollow: Story = {
  render: () => <ToastStory first={{ kind: "followed", network: SOCIAL_NETWORKS.x }} />,
};
