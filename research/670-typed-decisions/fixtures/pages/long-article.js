// Deterministic long article text: about 40k characters, far over Laya's 1024-token context.
(() => {
  const sentences = [
    "The river has shaped the valley for thousands of years, carving terraces that farmers still use today.",
    "Local historians trace the first mills to the twelfth century, when monks diverted a side channel.",
    "By the nineteenth century the valley supplied most of the region's flour and timber.",
    "Rail arrived in 1871 and changed the rhythm of village life almost overnight.",
    "Today the old mill buildings host a museum, a bakery and a small hydroelectric plant.",
    "Walkers can follow a marked path along the east bank from the station to the upper weir.",
  ];
  const article = document.querySelector("article");
  for (let i = 0; i < 70; i++) {
    const p = document.createElement("p");
    p.textContent = `${i + 1}. ${sentences.map((s, j) => sentences[(i + j) % sentences.length]).join(" ")}`;
    article.append(p);
  }
})();
