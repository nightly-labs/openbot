import i18n from "i18next";
import en from "./locales/en.json";
import pl from "./locales/pl.json";

void i18n.init({
  resources: {
    en: { translation: en },
    pl: { translation: pl },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
