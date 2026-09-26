import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const SEARCH_URL = "https://doc.wa.gov/records/incarcerated-data-search/incarcerated-search";
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";

function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseName(value: string): { firstName: string; middleName?: string; lastName: string } | null {
  const [lastPart, givenPart] = value.split(",", 2).map((part) => part.trim());
  const lastName = lastPart?.replace(/\s+(?:JR|SR|II|III|IV)\.?$/i, "").trim();
  const givenNames = givenPart?.split(/\s+/).filter(Boolean) ?? [];
  if (!lastName || givenNames.length === 0) return null;
  return {
    firstName: givenNames[0],
    middleName: givenNames.slice(1).join(" ") || undefined,
    lastName,
  };
}

export function parseWashingtonCorrectionsResults(html: string, query: PersonQuery): NormalizedPerson[] {
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cellMatch) => plainText(cellMatch[1]));
    if (cells.length < 5) return [];

    const [docNumber, fullName, age, facility, unit] = cells;
    const name = parseName(fullName);
    if (
      !/^\d+$/.test(docNumber) ||
      !name ||
      name.firstName.toLowerCase() !== requestedFirst ||
      name.lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const disposition = [
      "Currently incarcerated",
      age ? `Age: ${age}` : null,
      facility ? `Facility: ${facility}` : null,
      unit ? `Unit: ${unit}` : null,
    ].filter(Boolean).join(" | ");
    const sourceUrl = `${SEARCH_URL}?${new URLSearchParams({ field_doc_number_value: docNumber }).toString()}`;

    return [{
      externalId: docNumber,
      firstName: name.firstName,
      middleName: name.middleName,
      lastName: name.lastName,
      source: "washington_corrections",
      records: [{
        caseNumber: docNumber,
        courtName: "Washington State Department of Corrections",
        state: "WA",
        caseType: "corrections_record",
        disposition,
        sourceUrl,
      }],
    }];
  });
}

export class WashingtonCorrectionsConnector implements Connector {
  sourceName = "washington_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "WA") return [];

    const params = new URLSearchParams({
      field_first_name_value: query.firstName,
      field_last_name_value: query.lastName,
    });
    const response = await fetchWithRetry(`${SEARCH_URL}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) throw new Error(`Washington DOC incarcerated search failed: ${response.status}`);
    return parseWashingtonCorrectionsResults(await response.text(), query);
  }
}