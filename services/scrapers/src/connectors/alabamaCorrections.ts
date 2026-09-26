import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const SEARCH_URL = "https://www.doc.alabama.gov/inmate/inmate-search-results/";
const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV"]);

function plainText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function fieldValues(card: string): string[] {
  return [...card.matchAll(/class="jet-listing-dynamic-field__content"[^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => plainText(match[1]));
}

function parseName(value: string): { firstName: string; middleName?: string; lastName: string } | null {
  const [lastName, givenNames] = value.split(",", 2).map((part) => part.trim());
  const parts = givenNames?.split(/\s+/).filter(Boolean) ?? [];
  if (!lastName || parts.length === 0) return null;
  if (SUFFIXES.has(parts.at(-1) ?? "")) parts.pop();
  return { firstName: parts[0], middleName: parts.slice(1).join(" ") || undefined, lastName };
}

export function parseAlabamaResults(html: string, query: PersonQuery): NormalizedPerson[] {
  const cards = [...html.matchAll(/<div class="jet-listing-grid__item\b[\s\S]*?(?=<div class="jet-listing-grid__item\b|$)/gi)];
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return cards.flatMap((cardMatch) => {
    const card = cardMatch[0];
    const detail = card.match(/href="(https:\/\/www\.doc\.alabama\.gov\/inmate\/inmate-detail\/[^"/]+\/?)"/i);
    const ais = card.match(/aria-label="Inmate AIS\s+([^"\s]+)"/i)?.[1];
    const [fullName, race, sex, birthYear, institution, minimumReleaseDate, status] = fieldValues(card);
    const name = fullName ? parseName(fullName) : null;
    if (
      !ais ||
      !name ||
      name.firstName.toLowerCase() !== requestedFirst ||
      name.lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const parsedBirthYear = Number.parseInt(birthYear, 10);
    const disposition = [
      status ? `Status: ${status}` : null,
      institution ? `Institution: ${institution}` : null,
      minimumReleaseDate ? `Minimum release: ${minimumReleaseDate}` : null,
      race ? `Race: ${race}` : null,
      sex ? `Sex: ${sex}` : null,
    ].filter(Boolean).join(" | ");
    return [{
      externalId: ais,
      firstName: name.firstName,
      middleName: name.middleName,
      lastName: name.lastName,
      dobYear: Number.isInteger(parsedBirthYear) ? parsedBirthYear : undefined,
      source: "alabama_corrections",
      records: [{
        caseNumber: ais,
        courtName: "Alabama Department of Corrections",
        state: "AL",
        caseType: "corrections_record",
        disposition: disposition || undefined,
        sourceUrl: detail?.[1] ?? SEARCH_URL,
      }],
    }];
  });
}

export class AlabamaCorrectionsConnector implements Connector {
  sourceName = "alabama_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "AL") return [];
    const params = new URLSearchParams({
      inmate_search: `${query.firstName} ${query.lastName}`,
      jsearch: "",
    });
    const response = await fetchWithRetry(`${SEARCH_URL}?${params.toString()}`, {
      headers: { "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)" },
    });
    if (!response.ok) throw new Error(`Alabama ADOC search failed: ${response.status}`);
    return parseAlabamaResults(await response.text(), query);
  }
}