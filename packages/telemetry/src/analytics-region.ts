/**
 * Where first run can tick the product analytics box for the user. These countries let an app
 * collect usage data with notice and a clear way to turn it off. Everywhere else, the box starts
 * clear: the European Union, the United Kingdom, Brazil, Canada and other countries ask for consent
 * first, and a list of them would always be out of date. An unknown region also starts clear.
 *
 * Each country lists its IANA time zones, and the names V8 uses for some of them. The desktop app
 * reads the region of the operating system; the web app reads the region of the browser language.
 */
const DEFAULT_ON_TIME_ZONES: Readonly<Record<string, readonly string[]>> = {
  US: [
    "America/Adak",
    "America/Anchorage",
    "America/Boise",
    "America/Chicago",
    "America/Denver",
    "America/Detroit",
    "America/Indiana/Indianapolis",
    "America/Indiana/Knox",
    "America/Indiana/Marengo",
    "America/Indiana/Petersburg",
    "America/Indiana/Tell_City",
    "America/Indiana/Vevay",
    "America/Indiana/Vincennes",
    "America/Indiana/Winamac",
    "America/Indianapolis",
    "America/Juneau",
    "America/Kentucky/Louisville",
    "America/Kentucky/Monticello",
    "America/Los_Angeles",
    "America/Louisville",
    "America/Menominee",
    "America/Metlakatla",
    "America/New_York",
    "America/Nome",
    "America/North_Dakota/Beulah",
    "America/North_Dakota/Center",
    "America/North_Dakota/New_Salem",
    "America/Phoenix",
    "America/Sitka",
    "America/Yakutat",
    "Pacific/Honolulu",
  ],
  PR: ["America/Puerto_Rico"],
  VI: ["America/St_Thomas"],
  GU: ["Pacific/Guam"],
  MP: ["Pacific/Saipan"],
  AS: ["Pacific/Pago_Pago"],
  UM: ["Pacific/Midway", "Pacific/Wake"],
  MX: [
    "America/Bahia_Banderas",
    "America/Cancun",
    "America/Chihuahua",
    "America/Ciudad_Juarez",
    "America/Hermosillo",
    "America/Matamoros",
    "America/Mazatlan",
    "America/Merida",
    "America/Mexico_City",
    "America/Monterrey",
    "America/Ojinaga",
    "America/Tijuana",
  ],
  AU: [
    "Australia/Adelaide",
    "Australia/Brisbane",
    "Australia/Broken_Hill",
    "Australia/Darwin",
    "Australia/Eucla",
    "Australia/Hobart",
    "Australia/Lindeman",
    "Australia/Lord_Howe",
    "Australia/Melbourne",
    "Australia/Perth",
    "Australia/Sydney",
  ],
  NZ: ["Pacific/Auckland", "Pacific/Chatham"],
  JP: ["Asia/Tokyo"],
};

const DEFAULT_ON_ZONES = new Set(Object.values(DEFAULT_ON_TIME_ZONES).flat());

/**
 * True when both the region of the operating system and its time zone are in a country above. A
 * system with the United States region and the Berlin time zone gets the clear box.
 */
export function analyticsOnByDefault(countryCode: string, timeZone: string | undefined): boolean {
  return Object.hasOwn(DEFAULT_ON_TIME_ZONES, countryCode) && timeZone !== undefined && DEFAULT_ON_ZONES.has(timeZone);
}
