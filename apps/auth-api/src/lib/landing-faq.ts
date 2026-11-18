// The questions on the landing page are in the `sitePage.landing.faq.*` catalog keys. They are also
// the home page's FAQPage JSON-LD, so the questions a search engine reads are the ones the page shows.
// No imports: `site-metadata.ts` reads this, and the build config reads that.

export interface LandingQuestion {
  question: string;
  answer: string;
  /** Shown after the answer on the page. Not in the JSON-LD text. */
  link?: { label: string; href: string };
}

/** schema.org `FAQPage`, from the questions a page shows. */
export function faqStructuredData(questions: readonly LandingQuestion[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}
