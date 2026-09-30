import { AppLogo, type AppLogoVariant } from "@openbot/brand";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SPLASH_EYE_LENGTH_STYLE } from "../src/features/startup/StartupSplash";
import { SplashPlayground } from "./splash-concept";
import "./SplashScreenConcept.css";

const PRODUCT_NAME = "OpenBot";
// A short scribble in the same hand as the logo eyes. It draws and erases while the app loads.
const LOADER_POINTS = "3 10 10 4 13 10 21 4 24 10 32 4 35 10 43 4";

type SplashPhase = "intro" | "idle" | "exit";

interface SplashScreenProps {
  variant: AppLogoVariant;
  /** The app is ready. The splash finishes its intro first, then plays its exit. */
  ready: boolean;
  onExited?: () => void;
}

function SplashScreen(props: SplashScreenProps) {
  const { t } = useText();
  const [introDone, setIntroDone] = createSignal(false);
  const phase = (): SplashPhase => {
    if (!introDone()) return "intro";
    return props.ready ? "exit" : "idle";
  };

  function handleAnimationEnd(event: AnimationEvent): void {
    if (event.animationName === "splash-loader-in") {
      setIntroDone(true);
      return;
    }
    if (event.animationName === "splash-screen-exit" && event.target === event.currentTarget) props.onExited?.();
  }

  return (
    <main
      class="splash-screen"
      data-phase={phase()}
      data-variant={props.variant}
      role="status"
      aria-live="polite"
      aria-busy={phase() === "exit" ? "false" : "true"}
      style={SPLASH_EYE_LENGTH_STYLE}
      onAnimationEnd={handleAnimationEnd}
    >
      <div class="splash-stage">
        <div class="splash-mark">
          <AppLogo variant={props.variant} animation={phase() === "idle" ? "blink" : "none"} class="splash-logo" />
        </div>
        <span class="splash-wordmark">{PRODUCT_NAME}</span>
        <div class="splash-loader">
          <svg class="splash-scribble" viewBox="0 0 46 14" aria-hidden="true">
            <polyline class="splash-scribble-stroke" points={LOADER_POINTS} pathLength="1" />
          </svg>
          <p class="splash-label">{t("webClient.loading")}</p>
        </div>
      </div>
    </main>
  );
}

interface SplashStoryArgs {
  variant: AppLogoVariant;
  readyAfterMs: number;
}

function SplashStory(args: SplashStoryArgs) {
  return (
    <SplashPlayground readyAfterMs={args.readyAfterMs}>
      {(ready, onExited) => <SplashScreen variant={args.variant} ready={ready()} onExited={onExited} />}
    </SplashPlayground>
  );
}

const meta = {
  title: "Concepts/SplashScreen/Expressive",
  component: SplashStory,
  args: { variant: "production", readyAfterMs: 3200 },
  argTypes: {
    variant: { control: "select", options: ["production", "dev", "preview"] },
    readyAfterMs: { control: { type: "range", min: 0, max: 8000, step: 200 } },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SplashStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full sequence: the mark draws itself, idles while loading, then opens into the app. */
export const Sequence: Story = {};

/** The app is ready at once: the intro still completes before the exit. */
export const FastLoad: Story = { args: { readyAfterMs: 0 } };

/** The splash never finishes, so the idle loop can be inspected. */
export const Idle: Story = {
  render: (args) => <SplashScreen variant={args.variant} ready={false} />,
};
