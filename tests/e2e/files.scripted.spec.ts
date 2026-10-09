import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generatedFiles, html } from "./support/files";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, newAgent, openAgent, send, t } from "./support/ui";

test("files generates, previews, downloads, and uploads files", async ({ app, owner }) => {
  const agent = await newAgent(app);
  const files = generatedFiles();
  await openAgent(app, agent.name);
  await send(
    app,
    agent.name,
    prompt({
      steps: [
        ...files.map((file) => ({ kind: "write" as const, name: file.name, base64: file.bytes.toString("base64") })),
        { kind: "tool", name: "attach_files_to_response", args: { paths: files.map((file) => file.name) } },
        { kind: "tool", name: "html_render", args: { title: "Release counter", html } },
      ],
      reply: "Files generated",
    }),
  );
  await completed(app, agent.id, "Files generated");
  const downloads = join(app.profile, "downloads");
  await mkdir(downloads, { recursive: true });
  for (const file of files) {
    await expect(readFile(join(owner.profile, "workspace-home/OpenBot/Agents", agent.id, file.name))).resolves.toEqual(
      file.bytes,
    );
    await app.page.getByRole("button", { name: t("attachment.preview", { name: file.name }), exact: true }).click();
    const image = file.name.endsWith(".png");
    const preview = image
      ? app.page.getByRole("dialog", { name: file.name, exact: true })
      : app.page.getByRole("complementary", { name: t("preview.panel.label") });
    const close = app.page.getByRole("button", {
      name: t(image ? "chat.image.lightbox.close" : "preview.panel.close"),
    });
    await expect(preview).toBeVisible();
    if (file.name.endsWith(".md")) await expect(preview.getByRole("heading", { name: "Release report" })).toBeVisible();
    if (file.name.endsWith(".xlsx")) await expect(preview.getByRole("cell", { name: "42", exact: true })).toBeVisible();
    if (file.name.endsWith(".png"))
      await expect
        .poll(() =>
          preview
            .getByRole("img")
            .evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0),
        )
        .toBe(true);
    await close.click();
    await expect(preview).not.toBeVisible();
    await app.page.getByRole("button", { name: t("attachment.preview", { name: file.name }), exact: true }).click();
    await expect(preview).toBeVisible();
    await close.click();
    await expect(preview).not.toBeVisible();
    const destination = join(downloads, file.name);
    await app.downloadTo(destination);
    await app.page.getByRole("button", { name: t("attachment.download", { name: file.name }), exact: true }).click();
    await expect
      .poll(async () =>
        readFile(destination)
          .then((bytes) => bytes.equals(file.bytes))
          .catch(() => false),
      )
      .toBe(true);
  }
  const frame = app.page.getByTitle("Release counter", { exact: true }).contentFrame();
  await frame.getByRole("button", { name: "Count: 0" }).click();
  await expect(frame.getByRole("button", { name: "Count: 1" })).toBeVisible();
  const upload = join(app.profile, "upload.txt");
  await writeFile(upload, "Uploaded release input 42");
  await app.page.getByRole("button", { name: t("composer.add.label") }).click();
  const [chooser] = await Promise.all([
    app.page.waitForEvent("filechooser"),
    app.page.getByRole("menuitem", { name: t("composer.add.context"), exact: true }).click(),
  ]);
  await chooser.setFiles(upload);
  await expect(
    app.page.getByRole("button", { name: t("composer.attachment.remove", { name: "upload.txt" }) }),
  ).toBeVisible();
  await send(app, agent.name, prompt({ reply: "Upload received" }));
  await completed(app, agent.id, "Upload received");
  const snapshot = await app.page.evaluate((id) => window.openbot.agent.readConversation(id), agent.id);
  expect(
    snapshot.messages.some((message) => message.attachments?.some((attachment) => attachment.name === "upload.txt")),
  ).toBe(true);
  await app.page.getByRole("button", { name: t("attachment.preview", { name: "upload.txt" }), exact: true }).click();
  await expect(app.page.getByRole("complementary", { name: t("preview.panel.label") })).toContainText(
    "Uploaded release input 42",
  );
  await app.page.getByRole("button", { name: t("preview.panel.close") }).click();
});
