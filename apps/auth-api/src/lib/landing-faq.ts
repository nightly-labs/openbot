export interface LandingQuestion {
  question: string;
  answer: string;
  link?: { label: string; href: string };
}

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
