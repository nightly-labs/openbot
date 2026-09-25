import type { AgentTemplatePreview, AvatarImageInput } from "@openbot/contracts/ipc";
import { createSignal, onSettled, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { renderAgentTemplateCard } from "../src/features/agent-templates/agent-template-card";
import { storyAgentTemplatePreview } from "../src/preview/agent-template-fixtures";

/**
 * The PNG a publish uploads as the link preview of `openbot.run/agents/<id>`. The story draws it with
 * the same function the publish dialog uses and shows the result at its real size.
 */
function CardPreview(props: { preview: () => Promise<AgentTemplatePreview> }) {
  const [url, setUrl] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  onSettled(() => {
    let objectUrl: string | undefined;
    void props
      .preview()
      .then(renderAgentTemplateCard)
      .then((bytes) => {
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        setUrl(objectUrl);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  });
  return (
    <div style={{ padding: "24px", background: "var(--openbot-bg-notch)", "min-height": "100vh" }}>
      <Show
        when={url()}
        fallback={<p style={{ color: "var(--openbot-text-primary)" }}>{error() ?? "Drawing the card…"}</p>}
      >
        {(src) => <img src={src()} alt="Agent share card" width={1200} height={630} style={{ display: "block" }} />}
      </Show>
    </div>
  );
}

/** A stand-in for a photo the owner uploaded: a PNG drawn on a canvas, so the story needs no asset. */
async function samplePhoto(): Promise<AvatarImageInput> {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas.");
  const gradient = context.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, "#f59e0b");
  gradient.addColorStop(1, "#db2777");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = "#fff";
  context.font = "700 150px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("B", 128, 138);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No PNG.");
  return { mimeType: "image/png", bytes: new Uint8Array(await blob.arrayBuffer()) };
}

const meta = {
  title: "Agents/AgentTemplateCard",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const GeneratedAvatar: Story = {
  render: () => <CardPreview preview={async () => storyAgentTemplatePreview("dr-eggbot")} />,
};

export const UploadedPhoto: Story = {
  render: () => (
    <CardPreview
      preview={async () => ({
        ...storyAgentTemplatePreview("builder"),
        name: "Builder",
        title: "Product engineer",
        description:
          "Builds product changes and records clear technical decisions. Keeps the release checklist in order and asks before anything irreversible.",
        avatarImage: await samplePhoto(),
      })}
    />
  ),
};

export const LongName: Story = {
  render: () => (
    <CardPreview
      preview={async () => ({
        ...storyAgentTemplatePreview("launch"),
        name: "Go-to-market launch coordinator for the autumn release",
        avatarSeed: "launch",
        avatarHue: 320,
        title: "",
      })}
    />
  ),
};
