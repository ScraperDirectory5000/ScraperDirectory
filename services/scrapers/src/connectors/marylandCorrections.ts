import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const SEARCH_URL = "https://dpscs.maryland.gov/IncarceratedIndividualLocator/IncarceratedIndividualLocator";

function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function parseFullName(value: string): { firstName: string; middleName?: string; lastName: string } | null {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : undefined,
    lastName: parts.at(-1) as string,
  };
}

export function parseMarylandResults(html: string, query: PersonQuery): NormalizedPerson[] {
  const table = html.match(/<table\b[^>]*id="gvSearchInmate"[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) return [];
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cellMatch) => plainText(cellMatch[1]));
    if (cells.length < 7) return [];
    const [fullName, docNumber, sid, gender, dob, facilityCode, facilityName] = cells;
    const name = parseFullName(fullName);
    if (
      !name ||
      !docNumber ||
      name.firstName.toLowerCase() !== requestedFirst ||
      name.lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const year = Number.parseInt(dob.split("/").at(-1) ?? "", 10);
    const disposition = [
      facilityName || facilityCode ? `Facility: ${facilityName || facilityCode}` : null,
      sid ? `SID: ${sid}` : null,
      gender ? `Gender: ${gender}` : null,
    ].filter(Boolean).join(" | ");
    return [{
      externalId: docNumber,
      firstName: name.firstName,
      middleName: name.middleName,
      lastName: name.lastName,
      dobYear: Number.isInteger(year) ? year : undefined,
      source: "maryland_corrections",
      records: [{
        caseNumber: docNumber,
        courtName: "Maryland Department of Public Safety and Correctional Services",
        state: "MD",
        caseType: "corrections_record",
        disposition: disposition || undefined,
        sourceUrl: `${SEARCH_URL}?${new URLSearchParams({
          searchType: "name",
          FirstName: query.firstName,
          LastName: query.lastName,
        }).toString()}`,
      }],
    }];
  });
}

export class MarylandCorrectionsConnector implements Connector {
  sourceName = "maryland_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "MD") return [];
    const params = new URLSearchParams({
      searchType: "name",
      FirstName: query.firstName.slice(0, 14),
      LastName: query.lastName.slice(0, 19),
    });
    const response = await fetchWithRetry(`${SEARCH_URL}?${params.toString()}`, {
      headers: { "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)" },
    });
    if (!response.ok) throw new Error(`Maryland DPSCS search failed: ${response.status}`);
    return parseMarylandResults(await response.text(), query);
  }
}