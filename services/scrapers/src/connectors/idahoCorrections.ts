import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const SEARCH_URL = "https://www.idoc.idaho.gov/content/prisons/resident-client-search";

function textContent(html: string): string {
  return html
    .replace(/<div\b[^>]*class="col-header"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseIdocResults(html: string, query: PersonQuery): NormalizedPerson[] {
  const table = html.match(/<table\b[^>]*id="people-search-results"[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) return [];

  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();
  const resultUrl = `${SEARCH_URL}/results?${new URLSearchParams({
    first_name: query.firstName,
    last_name: query.lastName,
    number: "",
  }).toString()}`;

  return [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cellMatch) => textContent(cellMatch[1]));
    if (cells.length < 6) return [];

    const [idocNumber, lastName, firstName, middleName, birthYear, status] = cells;
    if (
      !idocNumber ||
      firstName.toLowerCase() !== requestedFirst ||
      lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const parsedBirthYear = Number.parseInt(birthYear, 10);
    return [{
      externalId: idocNumber,
      firstName,
      middleName: middleName || undefined,
      lastName,
      dobYear: Number.isInteger(parsedBirthYear) ? parsedBirthYear : undefined,
      source: "idaho_corrections",
      records: [{
        caseNumber: idocNumber,
        courtName: "Idaho Department of Correction",
        state: "ID",
        caseType: "corrections_record",
        disposition: status || undefined,
        sourceUrl: resultUrl,
      }],
    }];
  });
}

function responseCookies(response: Response): string {
  const setCookies = response.headers.getSetCookie();
  return setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

export class IdahoCorrectionsConnector implements Connector {
  sourceName = "idaho_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "ID") return [];

    const initial = await fetchWithRetry(SEARCH_URL, {
      headers: { "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)" },
    });
    if (!initial.ok) throw new Error(`Idaho IDOC search page failed: ${initial.status}`);
    const initialHtml = await initial.text();
    const formBuildId = initialHtml.match(/name="form_build_id"\s+value="([^"]+)"/i)?.[1];
    if (!formBuildId) throw new Error("Idaho IDOC search form token was not found");

    const form = new URLSearchParams({
      last_name: query.lastName,
      first_name: query.firstName,
      number: "",
      op: "Search",
      form_build_id: formBuildId,
      form_id: "people_search",
    });
    const response = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)",
        Cookie: responseCookies(initial),
      },
      body: form,
    });
    if (!response.ok) throw new Error(`Idaho IDOC search failed: ${response.status}`);
    return parseIdocResults(await response.text(), query);
  }
}