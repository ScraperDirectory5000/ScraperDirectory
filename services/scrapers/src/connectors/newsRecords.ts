import type { PersonQuery } from "../types.js";

const TOPICS: Array<[string, RegExp]> = [
  ["obituary_mention", /\b(obituary|obituaries|died|death|funeral|memorial)\b/i],
  ["birth_announcement", /\b(birth|born|newborn|births)\b/i],
  ["crime_news_mention", /\b(arrest|arrested|charged|crime|criminal|police|sheriff|indict|convict|sentenced|court)\b/i],
];

export function classifyNewsMention(text: string, personName?: string): string {
  let classificationText = text;
  if (personName) {
    const normalizedText = text.replace(/\s+/g, " ");
    const matchIndex = normalizedText.toLowerCase().indexOf(personName.toLowerCase());
    if (matchIndex === -1) return "newspaper_mention";
    classificationText = normalizedText.slice(Math.max(0, matchIndex - 200), matchIndex + personName.length + 200);
  }
  return TOPICS.find(([, pattern]) => pattern.test(classificationText))?.[0] ?? "newspaper_mention";
}

export function newsIdentity(query: PersonQuery): string {
  return [query.firstName, query.lastName, query.state ?? "all"].join("|").toLowerCase();
}

export const STATE_NAMES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california",
  CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa",
  KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri",
  MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey",
  NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio",
  OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina",
  SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont",
  VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
  DC: "district of columbia",
};