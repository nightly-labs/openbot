import { chatVisualDocument } from "@openbot/contracts/chat-visual";
import logoUrl from "../src/assets/openbot-logo-production.png?inline";
import takeoverUrl from "./assets/browser-takeover-preview.svg?inline";
import macMockUrl from "./assets/remote-desktop-mac-mock.png?inline";

const PAGES_ROUTE = "/__openbot/chat-visual";

/** Publishes a page to the Storybook server (`.storybook/chat-visual-pages.ts`) and gives its URL. */
export async function publishChatVisualPage(html: string): Promise<string> {
  const response = await fetch(PAGES_ROUTE, { method: "POST", body: chatVisualDocument(html) });
  if (!response.ok) throw new Error(`The Storybook server did not keep the page: ${response.status}`);
  return response.text();
}

/*
 * Pages that an agent could publish as a visual reply. Each follows the layout rules that the agent
 * gets: no background on the page, no outer card or title, and the theme variables for colour.
 */

/** A bar chart that its own script draws as SVG, with no library. */
export const INLINE_SVG_CHART = `<!doctype html>
<html><head>
<style>
  .chart { display: grid; gap: 8px; }
  .caption { color: var(--muted-foreground); font-size: 12px; }
  svg { width: 100%; height: 220px; display: block; }
  .label { fill: var(--muted-foreground); font-size: 11px; }
  .value { fill: var(--foreground); font-size: 11px; font-variant-numeric: tabular-nums; }
  .legend { display: flex; gap: 16px; font-size: 12px; color: var(--muted-foreground); }
  .legend span::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; background: var(--swatch); }
</style>
</head><body>
<div class="chart">
  <div class="caption">Agent runs per day, last week</div>
  <svg id="bars" role="img" aria-label="Agent runs per day: Monday 42, Tuesday 58, Wednesday 51, Thursday 74, Friday 66, Saturday 18, Sunday 12"></svg>
  <div class="legend"><span style="--swatch: var(--chart-1)">Finished</span><span style="--swatch: var(--chart-2)">Stopped</span></div>
</div>
<script>
  const days = [["Mon", 38, 4], ["Tue", 51, 7], ["Wed", 47, 4], ["Thu", 66, 8], ["Fri", 60, 6], ["Sat", 17, 1], ["Sun", 11, 1]];
  const svg = document.getElementById("bars");
  const draw = () => {
    const width = svg.clientWidth, height = 220, bottom = 24, top = 16;
    const max = Math.max(...days.map(([, done, stopped]) => done + stopped));
    const step = width / days.length, bar = Math.min(40, step * 0.6);
    const scale = (value) => (value / max) * (height - bottom - top);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.innerHTML = days.map(([day, done, stopped], index) => {
      const x = index * step + (step - bar) / 2;
      const doneHeight = scale(done), stoppedHeight = scale(stopped);
      const base = height - bottom;
      return '<rect x="' + x + '" y="' + (base - doneHeight) + '" width="' + bar + '" height="' + doneHeight + '" rx="3" fill="var(--chart-1)"/>' +
        '<rect x="' + x + '" y="' + (base - doneHeight - stoppedHeight - 2) + '" width="' + bar + '" height="' + stoppedHeight + '" rx="3" fill="var(--chart-2)"/>' +
        '<text class="value" x="' + (x + bar / 2) + '" y="' + (base - doneHeight - stoppedHeight - 8) + '" text-anchor="middle">' + (done + stopped) + '</text>' +
        '<text class="label" x="' + (x + bar / 2) + '" y="' + (height - 6) + '" text-anchor="middle">' + day + '</text>';
    }).join("");
  };
  new ResizeObserver(draw).observe(svg);
</script>
</body></html>`;

/** A line chart with Chart.js from a CDN, which a visual reply can load. */
export const CDN_CHART = `<!doctype html>
<html><head>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
<style>.frame { position: relative; height: 260px; }</style>
</head><body>
<div class="frame"><canvas id="chart" aria-label="Tokens used per week by provider" role="img"></canvas></div>
<script>
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  Chart.defaults.color = color("--muted-foreground");
  Chart.defaults.borderColor = color("--border");
  Chart.defaults.font.family = color("--font-sans");
  const series = (label, data, token) => ({ label, data, borderColor: color(token), backgroundColor: color(token), tension: 0.35, pointRadius: 0, borderWidth: 2 });
  new Chart(document.getElementById("chart"), {
    type: "line",
    data: {
      labels: ["W32", "W33", "W34", "W35", "W36", "W37", "W38", "W39"],
      datasets: [
        series("Claude", [1.2, 1.6, 1.4, 2.1, 2.4, 2.2, 2.9, 3.1], "--chart-1"),
        series("Codex", [0.8, 0.9, 1.3, 1.1, 1.5, 1.9, 1.7, 2.0], "--chart-2"),
        series("Grok", [0.2, 0.3, 0.3, 0.5, 0.4, 0.6, 0.8, 0.7], "--chart-3"),
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 8, boxHeight: 8 } } },
      scales: { y: { ticks: { callback: (value) => value + "M" } }, x: { grid: { display: false } } },
    },
  });
</script>
</body></html>`;

/** A comparison in boxes, as a mockup or a decision table. */
export const COMPARISON_MOCKUP = `<!doctype html>
<html><head>
<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .option { padding: 16px; border-radius: var(--radius); background: var(--card); border: 1px solid var(--border); display: grid; gap: 8px; }
  .option[data-pick] { border-color: var(--accent); }
  h3 { margin: 0; font-size: 14px; }
  .price { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
  ul { margin: 0; padding-left: 18px; color: var(--muted-foreground); font-size: 13px; }
  .tag { justify-self: start; font-size: 11px; color: var(--accent); }
</style>
</head><body>
<div class="grid">
  <section class="option"><h3>SQLite only</h3><div class="price">$0</div><ul><li>One file per computer</li><li>No sync</li></ul></section>
  <section class="option" data-pick><span class="tag">Recommended</span><h3>SQLite + relay</h3><div class="price">$4/mo</div><ul><li>Data stays local</li><li>Relay passes messages</li></ul></section>
  <section class="option"><h3>Hosted database</h3><div class="price">$25/mo</div><ul><li>Data leaves the computer</li><li>Breaks the product rule</li></ul></section>
</div>
</body></html>`;

/** A list of sources. A click on a link asks the app to open it in the browser. */
export const LINK_OUT = `<!doctype html>
<html><head>
<style>
  ol { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
  a { color: var(--accent); }
  small { color: var(--muted-foreground); }
</style>
</head><body>
<ol>
  <li><a href="https://modelcontextprotocol.io/specification">MCP specification</a> <small>JSON-RPC messages for apps</small></li>
  <li><a href="https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox">iframe sandbox</a> <small>opaque origins</small></li>
  <li><a href="javascript:alert(1)">A script link</a> <small>the app ignores it</small></li>
  <li><a href="#notes">A link in the page</a> <small>scrolls the page</small></li>
</ol>
<p id="notes"><small>Only http and https links go to the app.</small></p>
</body></html>`;

/** A page that is higher than a frame can be, so the frame stops at its limit and the page scrolls. */
export const TALL_PAGE = `<!doctype html>
<html><head>
<style>
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }
  th { color: var(--muted-foreground); font-weight: 500; }
</style>
</head><body>
<table><thead><tr><th>#</th><th>Run</th><th>Duration</th></tr></thead><tbody id="rows"></tbody></table>
<script>
  document.getElementById("rows").innerHTML = Array.from({ length: 90 }, (_, index) =>
    "<tr><td>" + (index + 1) + "</td><td>nightly-" + String(index + 1).padStart(3, "0") + "</td><td>" + (20 + ((index * 37) % 90)) + " s</td></tr>"
  ).join("");
</script>
</body></html>`;

/**
 * A collage of screenshots. The agent gives local image paths, and the app puts each image into the
 * page as a data URL when it publishes the page, so the page does not need the files later.
 */
export const IMAGE_COLLAGE = `<!doctype html>
<html><head>
<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  figure { margin: 0; display: grid; gap: 6px; }
  figure.wide { grid-column: 1 / -1; }
  img { width: 100%; height: 160px; object-fit: cover; border-radius: var(--radius); border: 1px solid var(--border); background: var(--card); }
  figure.wide img { height: 240px; }
  figcaption { color: var(--muted-foreground); font-size: 12px; }
</style>
</head><body>
<div class="grid">
  <figure class="wide"><img src="${macMockUrl}" alt="Remote desktop on a Mac"><figcaption>Remote desktop, full screen</figcaption></figure>
  <figure><img src="${takeoverUrl}" alt="Browser takeover"><figcaption>Browser takeover</figcaption></figure>
  <figure><img src="${logoUrl}" alt="OpenBot logo" style="object-fit: contain"><figcaption>App logo</figcaption></figure>
</div>
</body></html>`;
