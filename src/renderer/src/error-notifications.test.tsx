import type { FailureProperties } from "@openbot/telemetry";
import { Alert, NotificationObserver, Toaster, toast } from "@openbot/ui";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { actionToast } from "./action-toast";

afterEach(() => {
  toast.dismiss();
});
it("reports direct, action and promise failures without sending display text or repeating on remount", async () => {
  const reports: FailureProperties[] = [];
  const view = render(() => <Toaster onToastShown={(event) => reports.push(event)} />);
  toast.error("Private file name", {
    report: { operation: "attachment", source: "upload", cause_code: "attachment_upload_failed" },
  });
  await screen.findByText("Private file name");
  await waitFor(() => expect(reports).toHaveLength(1));
  actionToast.warning("Private account name", {
    report: { operation: "auth", source: "action", cause_code: "authentication" },
  });
  await screen.findByText("Private account name");
  await waitFor(() => expect(reports).toHaveLength(2));
  let fail: (error: Error) => void = () => {};
  const request = new Promise<void>((_resolve, reject) => {
    fail = reject;
  });
  toast.promise(request, {
    loading: "Working",
    error: "Upload failed",
    report: { operation: "attachment", source: "upload", cause_code: "unknown" },
  });
  await screen.findByText("Working");
  fail(new Error("Invalid upload request. private-token"));
  await screen.findByText("Upload failed");
  await waitFor(() => expect(reports).toHaveLength(3));
  expect(reports[2]).toMatchObject({
    operation: "attachment",
    cause_code: "invalid_upload_request",
    presentation: "toast",
  });
  view.unmount();
  render(() => <Toaster onToastShown={(event) => reports.push(event)} />);
  await screen.findByText("Upload failed");
  expect(reports).toHaveLength(3);
  toast.success("Done");
  toast.info("Information");
  await screen.findByText("Information");
  expect(reports).toHaveLength(3);
  expect(JSON.stringify(reports)).not.toMatch(/Private|private-token|Upload failed/);
});

it("reports shared error and warning banners without reporting success or repeated rendering", async () => {
  const reports: FailureProperties[] = [];
  const [label, setLabel] = createSignal("Private banner text");
  render(() => (
    <NotificationObserver onShown={(report) => reports.push(report)}>
      <Alert tone="danger" report={{ operation: "auth", source: "auth", cause_code: "authentication" }}>
        {label()}
      </Alert>
      <Alert tone="warning">Private warning</Alert>
      <Alert tone="success">Success</Alert>
      <Alert>Information</Alert>
    </NotificationObserver>
  ));
  await waitFor(() => expect(reports).toHaveLength(2));
  setLabel("Other private display text");
  await screen.findByText("Other private display text");
  expect(reports).toHaveLength(2);
  expect(reports[0]).toMatchObject({ presentation: "banner", severity: "error", cause_code: "authentication" });
  expect(reports[1]).toMatchObject({ presentation: "banner", severity: "warning" });
  expect(JSON.stringify(reports)).not.toMatch(/Private|private|Success|Information/);
});
