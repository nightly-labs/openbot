// Shared site chrome, so every fixture carries the navigation and footer noise real pages have.
// A "Sign in" link on every page keeps keyword rules honest.
(() => {
  const lang = document.documentElement.lang || "en";
  const labels = {
    en: ["Home", "Products", "Pricing", "Blog", "Help", "Sign in", "Privacy", "Terms", "Contact us"],
    pl: ["Strona główna", "Produkty", "Cennik", "Blog", "Pomoc", "Zaloguj się", "Prywatność", "Regulamin", "Kontakt"],
    zh: ["首页", "产品", "价格", "博客", "帮助", "登录", "隐私", "条款", "联系我们"],
  }[lang];
  const header = document.createElement("header");
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Main");
  for (const label of labels.slice(0, 6)) {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = label;
    nav.append(link, " ");
  }
  header.append(nav);
  document.body.prepend(header);
  const footer = document.createElement("footer");
  for (const label of labels.slice(6)) {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = label;
    footer.append(link, " ");
  }
  footer.append(" © 2026 Example Inc.");
  document.body.append(footer);
})();
