// A weekly lesson calendar for the ambiguous-target checks (#4264). Five lessons share the layout
// attribute `data-mh="event-7"` and a "Register" button, as on the calendar in the issue; only their
// date, time, title and location tell them apart. The server records each registration, so a check
// can prove which lesson an action booked and that nothing booked twice.

import type { IncomingMessage, ServerResponse } from "node:http";

export interface FixtureLesson {
  id: string;
  day: string;
  date: string;
  time: string;
  title: string;
  location: string;
  layout: string;
}

export const LESSONS: readonly FixtureLesson[] = [
  {
    id: "L-1041",
    day: "Monday",
    date: "Mon 3 Nov",
    time: "18:00–19:00",
    title: "Yoga Flow",
    location: "Studio A",
    layout: "event-7",
  },
  {
    id: "L-1042",
    day: "Tuesday",
    date: "Tue 4 Nov",
    time: "07:30–08:30",
    title: "Yoga Flow",
    location: "Studio B",
    layout: "event-7",
  },
  {
    id: "L-1043",
    day: "Wednesday",
    date: "Wed 5 Nov",
    time: "18:00–19:00",
    title: "Yoga Flow",
    location: "Studio A",
    layout: "event-7",
  },
  {
    id: "L-1044",
    day: "Thursday",
    date: "Thu 6 Nov",
    time: "18:00–19:00",
    title: "Yoga Flow",
    location: "Studio B",
    layout: "event-7",
  },
  {
    id: "L-2001",
    day: "Thursday",
    date: "Thu 6 Nov",
    time: "19:30–20:30",
    title: "Boxing Basics",
    location: "Hall",
    layout: "event-3",
  },
  {
    id: "L-1045",
    day: "Friday",
    date: "Fri 7 Nov",
    time: "12:00–13:00",
    title: "Pilates Core",
    location: "Studio B",
    layout: "event-7",
  },
];

function lessonById(id: string): FixtureLesson {
  const lesson = LESSONS.find((one) => one.id === id);
  if (!lesson) throw new Error(`No fixture lesson ${id}.`);
  return lesson;
}

/** The lesson that the checks ask for: the only Thursday 18:00 Yoga Flow in Studio B. */
export const TARGET_LESSON = lessonById("L-1044");

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function card(lesson: FixtureLesson): string {
  return `<div class="event" data-mh="${lesson.layout}" meta:id="${lesson.id}">
      <p class="when">${escapeHtml(lesson.date)} · ${escapeHtml(lesson.time)}</p>
      <h3>${escapeHtml(lesson.title)}</h3>
      <p class="where">${escapeHtml(lesson.location)}</p>
      <button type="button" data-lesson="${lesson.id}">Register</button>
    </div>`;
}

function page(): string {
  const days = [...new Set(LESSONS.map((lesson) => lesson.day))];
  const columns = days
    .map(
      (day) => `<section class="day"><h2>${day}</h2>
    ${LESSONS.filter((lesson) => lesson.day === day)
      .map(card)
      .join("\n    ")}
  </section>`,
    )
    .join("\n  ");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Lesson calendar</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px; }
  .week { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .event { border: 1px solid #ccc; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
  .event p, .event h3 { margin: 2px 0; }
</style>
<h1>Lesson calendar</h1>
<p role="status" id="status">Choose a lesson.</p>
<main class="week">
  ${columns}
</main>
<script>
  window.fixtureClicks = 0;
  document.addEventListener("click", () => { window.fixtureClicks += 1; }, true);
  for (const button of document.querySelectorAll("button[data-lesson]")) {
    button.addEventListener("click", async () => {
      if (button.textContent === "Registered") return;
      const response = await fetch("/register?id=" + encodeURIComponent(button.dataset.lesson), { method: "POST" });
      const result = await response.json();
      button.textContent = "Registered";
      document.getElementById("status").textContent = "You are registered for " + result.summary + ".";
    });
  }
</script>
</html>`;
}

/** The calendar's routes on a loopback server, and the registrations it recorded. */
export class LessonCalendar {
  readonly registrations: string[] = [];

  reset(): void {
    this.registrations.length = 0;
  }

  /** Answers `/calendar` and `/register`. False for any other path. */
  handle(request: IncomingMessage, response: ServerResponse): boolean {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/calendar") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(page());
      return true;
    }
    if (url.pathname === "/register" && request.method === "POST") {
      const lesson = LESSONS.find((one) => one.id === url.searchParams.get("id"));
      response.setHeader("content-type", "application/json");
      if (!lesson) {
        response.statusCode = 404;
        response.end("{}");
        return true;
      }
      this.registrations.push(lesson.id);
      response.end(JSON.stringify({ summary: `${lesson.title}, ${lesson.date} ${lesson.time}, ${lesson.location}` }));
      return true;
    }
    return false;
  }
}
