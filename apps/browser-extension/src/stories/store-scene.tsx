// A Chrome window at the Web Store's 1280×800, with a web page and the OpenBot side panel, for the
// store pictures. The sites are made up. Storybook only.
import "./store-scene.css";
import { ArrowLeft, ArrowRight, Lock, PanelRight, Pin, Plus, Puzzle, Search, Star, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import openBotIcon from "../../public/icons/icon-32.png";

export interface SceneTab {
  title: string;
  /** The site's mark: a letter on a colour. */
  mark: string;
  color: string;
  active?: boolean;
  /** The tab is in the "OpenBot" tab group, which agents may use. */
  shared?: boolean;
}

/** The window: tabs, the address bar, the page, and the side panel on the right. */
export function BrowserScene(props: { tabs: SceneTab[]; url: string; page: JSX.Element; panel: JSX.Element }) {
  const shared = () => props.tabs.filter((tab) => tab.shared);
  const others = () => props.tabs.filter((tab) => !tab.shared);
  return (
    <div class="scene-stage">
      <div class="scene-window">
        <div class="scene-tabs">
          <span class="scene-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <Show when={shared().length > 0}>
            <span class="scene-group">OpenBot</span>
            <For each={shared()}>{(tab) => <Tab tab={tab} />}</For>
          </Show>
          <For each={others()}>{(tab) => <Tab tab={tab} />}</For>
          <Plus size={16} class="scene-new-tab" />
        </div>
        <div class="scene-toolbar">
          <ArrowLeft size={16} />
          <ArrowRight size={16} class="scene-dim" />
          <div class="scene-omnibox">
            <Lock size={13} />
            <span>{props.url}</span>
            <Star size={14} class="scene-star" />
          </div>
          <Puzzle size={16} />
          <img src={openBotIcon} alt="" class="scene-ext-icon" />
          <PanelRight size={16} />
          <span class="scene-profile">S</span>
        </div>
        <div class="scene-body">
          <div class="scene-page">{props.page}</div>
          <aside class="scene-side">
            <div class="scene-side-head">
              <img src={openBotIcon} alt="" />
              <span>OpenBot</span>
              <Pin size={14} class="scene-side-pin" />
              <X size={15} />
            </div>
            <main class="ext-app scene-panel">{props.panel}</main>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Tab(props: { tab: SceneTab }) {
  return (
    <span
      class="scene-tab"
      data-active={props.tab.active ? "" : undefined}
      data-shared={props.tab.shared ? "" : undefined}
    >
      <i class="scene-favicon" style={{ background: props.tab.color }}>
        {props.tab.mark}
      </i>
      <span class="scene-tab-title">{props.tab.title}</span>
      <X size={12} class="scene-tab-close" />
    </span>
  );
}

/** A news article that the user reads. */
export function ArticlePage() {
  return (
    <div class="site site-news">
      <header class="site-bar">
        <strong class="site-logo">The Morning Ledger</strong>
        <nav>
          <span>World</span>
          <span>Business</span>
          <span class="site-on">Work &amp; AI</span>
          <span>Science</span>
        </nav>
        <Search size={16} />
      </header>
      <article class="news-article">
        <p class="news-kicker">WORK &amp; AI</p>
        <h1>Support teams will hand 40% of their tickets to AI agents by March</h1>
        <p class="news-byline">By Maya Torres · 6 min read · Updated today</p>
        <div class="news-hero" />
        <p>
          A survey of 180 companies finds that support teams plan to move almost half of their routine tickets to AI
          agents in the next quarter. Most of them will keep their hiring plans, but start new roles later in the year.
        </p>
        <p>
          “The agents take the repeat questions first,” says one support lead. “Our people move to the hard cases, and
          the queue is shorter than it was a year ago.”
        </p>
        <h2>Budgets move to tools</h2>
        <p>
          The companies in the survey plan to move about a tenth of their contractor budget to agent tools. The authors
          warn that the sample is small, and that results differ by industry.
        </p>
      </article>
    </div>
  );
}

/** Search results of a flight site, in a tab that the user shares with agents. */
export function FlightsPage() {
  const flights = [
    { time: "9:40 → 13:05", price: "$142", note: "Direct · 3 h 25 min · Bag included", best: true },
    { time: "13:15 → 16:45", price: "$168", note: "Direct · 3 h 30 min · Bag +$35", best: false },
    { time: "18:50 → 22:20", price: "$191", note: "Direct · 3 h 30 min · Bag included", best: false },
    { time: "7:05 → 14:10", price: "$129", note: "1 stop · 7 h 05 min · Bag +$35", best: false },
    { time: "11:20 → 17:55", price: "$136", note: "1 stop · 6 h 35 min · Bag +$35", best: false },
    { time: "21:30 → 01:00", price: "$205", note: "Direct · 3 h 30 min · Bag included", best: false },
  ];
  return (
    <div class="site site-flights">
      <header class="site-bar">
        <strong class="site-logo">✈ SkyCompare</strong>
        <nav>
          <span class="site-on">Flights</span>
          <span>Hotels</span>
          <span>Cars</span>
        </nav>
      </header>
      <div class="flights-search">
        <span>Berlin (BER)</span>
        <span>→</span>
        <span>Lisbon (LIS)</span>
        <span>Fri, Dec 12</span>
        <span>1 adult · Economy</span>
        <button type="button">Search</button>
      </div>
      <div class="flights-filters">
        <span class="site-chip site-chip-on">Direct only</span>
        <span class="site-chip">Bag included</span>
        <span class="site-chip">Morning</span>
        <span class="site-chip">Sort: price</span>
      </div>
      <div class="flights-list">
        <For each={flights}>
          {(flight) => (
            <div class="flight" data-best={flight.best ? "" : undefined}>
              <div>
                <p class="flight-time">{flight.time}</p>
                <p class="flight-note">{flight.note}</p>
              </div>
              <Show when={flight.best}>
                <span class="flight-badge">Best match</span>
              </Show>
              <p class="flight-price">{flight.price}</p>
              <button type="button">Select</button>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/** A product page that Price Watch watches. */
export function ShopPage() {
  return (
    <div class="site site-shop">
      <header class="site-bar">
        <strong class="site-logo">Northwind Audio</strong>
        <nav>
          <span>Headphones</span>
          <span>Speakers</span>
          <span>Deals</span>
        </nav>
        <span class="shop-cart">Cart · 1</span>
      </header>
      <div class="shop-product">
        <div class="shop-picture">
          <svg class="shop-headphones" viewBox="0 0 120 120" aria-hidden="true">
            <path
              d="M24 70 V58 a36 36 0 0 1 72 0 V70"
              fill="none"
              stroke="#2b2f36"
              stroke-width="7"
              stroke-linecap="round"
            />
            <rect x="14" y="64" width="24" height="38" rx="10" fill="#2b2f36" />
            <rect x="82" y="64" width="24" height="38" rx="10" fill="#2b2f36" />
            <rect x="20" y="70" width="12" height="26" rx="6" fill="#4c6ef5" />
            <rect x="88" y="70" width="12" height="26" rx="6" fill="#4c6ef5" />
          </svg>
        </div>
        <div class="shop-info">
          <p class="shop-crumbs">Headphones › Wireless › Over-ear</p>
          <h1>Aurora 2 Wireless Headphones</h1>
          <p class="shop-rating">★★★★★ 4.8 · 2,310 reviews</p>
          <p class="shop-price">
            $189 <s>$249</s>
          </p>
          <p class="shop-deal">Lowest price in 90 days · Deal ends Sunday</p>
          <div class="shop-colors">
            <i style={{ background: "#1f2937" }} />
            <i style={{ background: "#e5e7eb" }} />
            <i style={{ background: "#3b5bdb" }} />
          </div>
          <button type="button" class="shop-buy">
            ✓ Added to cart
          </button>
          <ul>
            <li>40 hours of battery</li>
            <li>Active noise cancelling</li>
            <li>Free delivery on Tuesday</li>
          </ul>
        </div>
      </div>
      <div class="shop-more">
        <p>Customers also viewed</p>
        <div>
          <For each={["Aurora 2 Case · $29", "Breeze Earbuds · $99", "Studio Stand · $39", "Aurora 1 · $129"]}>
            {(item) => (
              <span class="shop-more-item">
                <i />
                {item}
              </span>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

/** The launch plan of a team, in a shared document. */
export function DocsPage() {
  const items = [
    { done: true, text: "Freeze the release branch", owner: "Builder" },
    { done: true, text: "Update the launch checklist", owner: "Launch" },
    { done: true, text: "Write the launch post and email", owner: "Writer" },
    { done: false, text: "Fix the pricing page", owner: "Builder" },
    { done: false, text: "Check the numbers in the press note", owner: "Research" },
    { done: false, text: "Publish on Thursday at 10:00", owner: "You" },
  ];
  return (
    <div class="site site-docs">
      <header class="docs-bar">
        <span class="docs-icon">▤</span>
        <div>
          <strong>Launch plan · Thursday</strong>
          <p>Edited 2 minutes ago</p>
        </div>
        <span class="docs-share">Share</span>
      </header>
      <div class="docs-paper">
        <h1>Launch plan</h1>
        <p class="docs-lead">Ship version 2.0 on Thursday, December 4. The flag stays off until all checks pass.</p>
        <h2>Checklist</h2>
        <ul class="docs-list">
          <For each={items}>
            {(item) => (
              <li data-done={item.done ? "" : undefined}>
                <i>{item.done ? "✓" : ""}</i>
                <span class="docs-text">{item.text}</span>
                <em>{item.owner}</em>
              </li>
            )}
          </For>
        </ul>
        <h2>Numbers</h2>
        <p>Signups grew 38% since the beta. Support answers in 2 hours on average.</p>
      </div>
    </div>
  );
}

/** A mail inbox, beside the home. */
export function MailPage() {
  const mails = [
    {
      from: "Lena Fischer",
      subject: "Contract for the Lisbon offsite",
      preview: "Hi, the venue sent the final…",
      time: "10:24",
      unread: true,
    },
    {
      from: "Billing",
      subject: "Your November invoice",
      preview: "Your invoice for November is ready…",
      time: "9:58",
      unread: true,
    },
    {
      from: "Tom Becker",
      subject: "Re: Thursday launch",
      preview: "Looks good to me. One question about…",
      time: "9:12",
      unread: true,
    },
    {
      from: "Design team",
      subject: "New icons for the app",
      preview: "Here are the last versions of the…",
      time: "Yesterday",
      unread: false,
    },
    {
      from: "Priya Nair",
      subject: "Coffee next week?",
      preview: "I am in Berlin from Tuesday to…",
      time: "Yesterday",
      unread: false,
    },
    {
      from: "Calendar",
      subject: "Friday call moved to 4 PM",
      preview: "The organizer changed the time…",
      time: "Mon",
      unread: false,
    },
    {
      from: "Northwind Audio",
      subject: "Your order has shipped",
      preview: "Good news! Your order is on its way…",
      time: "Mon",
      unread: false,
    },
    {
      from: "Marta Silva",
      subject: "Lisbon dinner recommendations",
      preview: "You must try the place near the river…",
      time: "Sun",
      unread: false,
    },
    {
      from: "HR",
      subject: "Holiday calendar for December",
      preview: "The office is closed from the 24th…",
      time: "Sat",
      unread: false,
    },
    {
      from: "Daniel Okafor",
      subject: "Slides for Monday",
      preview: "I added the numbers from Research…",
      time: "Fri",
      unread: false,
    },
    {
      from: "Travel desk",
      subject: "Your trip to Lisbon",
      preview: "Your hotel booking is confirmed for…",
      time: "Fri",
      unread: false,
    },
    {
      from: "Product updates",
      subject: "What is new in December",
      preview: "Three new features that save you…",
      time: "Thu",
      unread: false,
    },
  ];
  return (
    <div class="site site-mail">
      <header class="site-bar">
        <strong class="site-logo">✉ Mailbox</strong>
        <div class="mail-search">
          <Search size={14} /> Search mail
        </div>
      </header>
      <div class="mail-body">
        <nav class="mail-folders">
          <span class="mail-folder site-on">Inbox · 3</span>
          <span class="mail-folder">Starred</span>
          <span class="mail-folder">Sent</span>
          <span class="mail-folder">Drafts · 9</span>
          <span class="mail-folder">Archive</span>
        </nav>
        <ul class="mail-list">
          <For each={mails}>
            {(mail) => (
              <li data-unread={mail.unread ? "" : undefined}>
                <strong>{mail.from}</strong>
                <span class="mail-line">
                  <b>{mail.subject}</b> — {mail.preview}
                </span>
                <time>{mail.time}</time>
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
}
