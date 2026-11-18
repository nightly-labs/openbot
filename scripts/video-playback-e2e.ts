// Run from a worktree's own `bun run dev` session, never a shared profile.
// bun scripts/video-playback-e2e.ts --allow-mutations [--label=before]
// Writes a report and screenshot under .openbot-build/video-playback-e2e/.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator, Page } from "playwright-core";
import { argument, ChannelClient, connectChannelE2e, writeReport } from "./channel-e2e-support";

const label = argument("label") ?? "after";
assert.ok(/^[a-z-]+$/u.test(label), "Use a lower-case label for the report.");
const output = `video-playback-e2e/${label}`;
const out = resolve(".openbot-build", output);
mkdirSync(out, { recursive: true });
const session = await connectChannelE2e("video-playback-e2e");
const { page } = session;
const client = new ChannelClient(page);
const name = `Video playback ${crypto.randomUUID().slice(0, 8)}`;
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };
page.setDefaultTimeout(12_000);

/** Make two portrait attachments in the dev renderer. They contain only a moving test pattern. */
async function importClips(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create the video fixture canvas.");
    const stream = canvas.captureStream(20);
    try {
      const recorder = new MediaRecorder(stream, { mimeType: "video/mp4" });
      const chunks: Blob[] = [];
      const stopped = new Promise<void>((done) => recorder.addEventListener("stop", () => done(), { once: true }));
      recorder.addEventListener("dataavailable", ({ data }) => chunks.push(data));
      recorder.start();
      const start = performance.now();
      await new Promise<void>((done) => {
        const draw = (now: number) => {
          context.fillStyle = "#29485a";
          context.fillRect(0, 0, 160, 320);
          context.fillStyle = "#f0cd83";
          context.fillRect(40, (now - start) / 24, 80, 80);
          if (now - start < 6_000) requestAnimationFrame(draw);
          else done();
        };
        requestAnimationFrame(draw);
      });
      recorder.stop();
      await stopped;
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      const drafts = await window.openbot.agent.importAttachmentData([
        { name: "Portrait A.mp4", mimeType: "video/mp4", bytes },
        { name: "Portrait B.mp4", mimeType: "video/mp4", bytes },
      ]);
      return drafts.map(({ id }) => id);
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  });
}

function player(name: string): Locator {
  return page.locator(".media-generation-player").filter({ has: page.getByLabel(name, { exact: true }) });
}

async function rate(target: Locator, expected: number): Promise<void> {
  await target.getByRole("button", { name: `Playback speed: ${expected}×` }).waitFor();
  const actual = await target.locator("video").evaluate((element) => {
    if (!(element instanceof HTMLVideoElement)) throw new Error("The attachment is not a video.");
    return element.playbackRate;
  });
  assert.equal(actual, expected);
}

async function dragPosition(target: Locator): Promise<void> {
  const track = target.locator(".ui-seek-slider-track");
  const box = await track.boundingBox();
  assert.ok(box && box.width >= 24, `The video seek track has only ${box?.width ?? 0}px for pointer input.`);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, y, { steps: 5 });
  await page.mouse.up();
  const video = target.locator("video");
  await video.evaluate(async (element) => {
    if (!(element instanceof HTMLVideoElement)) throw new Error("The attachment is not a video.");
    if (element.seeking)
      await new Promise<void>((done) => element.addEventListener("seeked", () => done(), { once: true }));
    if (element.currentTime <= 2) throw new Error("Dragging the track must seek the video.");
  });
}

try {
  const chatList = page.getByRole("navigation", { name: "Chat list" });
  if (!(await chatList.isVisible())) await page.getByRole("button", { name: "Agents", exact: true }).click();
  const channel = await client.create(name, [], null);
  const attachmentDraftIds = await importClips(page);
  assert.equal(attachmentDraftIds.length, 2);
  await client.command({
    type: "send",
    operationId: crypto.randomUUID(),
    channelId: channel.id,
    text: "Portrait playback fixtures",
    recipientAgentId: null,
    replyToMessageId: null,
    attachmentDraftIds,
  });
  await chatList.getByRole("button", { name: new RegExp(`^${name}[,.]`, "u") }).click();
  const first = player("Portrait A.mp4");
  const second = player("Portrait B.mp4");
  await first.getByRole("slider", { name: "Video position" }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("video")].some(
      (video) => video.videoWidth === 160 && Number.isFinite(video.duration),
    ),
  );
  await first.hover({ position: { x: 30, y: 30 } });
  await rate(first, 1);
  for (const speed of [1.25, 1.5, 2]) {
    await first.getByRole("button", { name: /^Playback speed:/u }).click();
    await rate(first, speed);
  }
  report.checks.push("Four speeds apply to the portrait chat attachment.");
  await first.screenshot({ path: resolve(out, "chat-portrait.png") });
  await dragPosition(first);
  await rate(first, 2);
  const fullscreen = first.getByRole("button", { name: "Full screen", exact: true });
  await fullscreen.click();
  await first.getByRole("button", { name: "Exit full screen", exact: true }).waitFor();
  await rate(first, 2);
  await page.keyboard.press("Escape");
  await fullscreen.waitFor();
  report.checks.push("Mouse drag and full screen keep 2× on the portrait attachment.");
  await rate(second, 1);
  report.checks.push("The other attachment starts at 1×.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${report.error}\n`);
  process.exitCode = 1;
} finally {
  await client.cleanup();
  await session.close();
  process.stdout.write(`Video playback E2E report: ${writeReport(output, report)}\n`);
}
