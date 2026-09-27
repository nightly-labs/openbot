import { createFileRoute } from "@tanstack/solid-router";
import { llmsTxtResponse } from "../server/llms-txt";

export const Route = createFileRoute("/llms.txt")({
  server: { handlers: { GET: llmsTxtResponse } },
});
