import { createFileRoute } from "@tanstack/solid-router";
import { LandingPage } from "../components/landing/LandingPage";
import { openBotHomeHead } from "../lib/site-metadata";
import { OPENBOT_SOFTWARE_APPLICATION } from "../lib/software-application";

export const Route = createFileRoute("/")({
  head: () => openBotHomeHead(OPENBOT_SOFTWARE_APPLICATION),
  component: LandingPage,
});
