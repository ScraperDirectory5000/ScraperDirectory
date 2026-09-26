import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const SEARCH_URL = "https://www.idoc.state.il.us/subsections/search/ISdefault2.asp";
const SEARCH_RESULTS_URL = "https://www.idoc.state.il.us/subsections/search/ISListInmates2.asp";
const DETAIL_URL = "https://www.idoc.state.il.us/subsections/search/ISinms2.asp";
const SOURCE_URL = "https://idoc.illinois.gov/offender/inmatesearch.html";
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";

interface IllinoisCandidate {
  idocNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  dobYear?: number;
}

function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cookieHeader(response: Response): string {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

function parseName(value: string): Omit<IllinoisCandidate, "idocNumber" | "dobYear"> | null {
  const [lastName, givenNames] = value.split(",", 2).map((part) => part.trim());
  const parts = givenNames?.split(/\s+/).filter(Boolean) ?? [];
  if (!lastName || parts.length === 0) return null;
  return {
    firstName: parts[0],
    middleName: parts.slice(1).join(" ").replace(/\.$/, "") || undefined,
    lastName,
  };
}

export function parseIllinoisCandidates(html: string, query: PersonQuery): IllinoisCandidate[] {
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return [...html.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)].flatMap((match) => {
    const [idocNumber, dob, fullName] = plainText(match[1]).split("|").map((part) => part.trim());
    const name = fullName ? parseName(fullName) : null;
    if (
      !idocNumber ||
      !name ||
      name.firstName.toLowerCase() !== requestedFirst ||
      name.lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const year = Number.parseInt(dob?.split("-").at(-1) ?? "", 10);
    return [{
      idocNumber,
      ...name,
      dobYear: Number.isInteger(year) ? year : undefined,
    }];
  });
}

function labeledValue(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<td\\b[^>]*>[\\s\\S]*?${escaped}:?[\\s\\S]*?<\\/td>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>`, "i"));
  return match ? plainText(match[1]) || undefined : undefined;
}

export function parseIllinoisDetail(html: string, candidate: IllinoisCandidate): NormalizedPerson {
  const institution = labeledValue(html, "Parent Institution");
  const status = labeledValue(html, "Offender Status");
  const location = labeledValue(html, "Location");
  const disposition = [
    status ? `Status: ${status}` : null,
    institution ? `Institution: ${institution}` : null,
    location ? `Location: ${location}` : null,
  ].filter(Boolean).join(" | ");

  return {
    externalId: candidate.idocNumber,
    firstName: candidate.firstName,
    middleName: candidate.middleName,
    lastName: candidate.lastName,
    dobYear: candidate.dobYear,
    source: "illinois_corrections",
    records: [{
      caseNumber: candidate.idocNumber,
      courtName: "Illinois Department of Corrections",
      state: "IL",
      caseType: "corrections_record",
      disposition: disposition || undefined,
      sourceUrl: SOURCE_URL,
    }],
  };
}

export class IllinoisCorrectionsConnector implements Connector {
  sourceName = "illinois_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "IL") return [];

    const initial = await fetchWithRetry(SEARCH_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!initial.ok) throw new Error(`Illinois IDOC search page failed: ${initial.status}`);
    const cookie = cookieHeader(initial);
    if (!cookie) throw new Error("Illinois IDOC search session cookie was not provided");

    const results = await fetchWithRetry(SEARCH_RESULTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Cookie: cookie,
        Origin: "https://www.idoc.state.il.us",
        Referer: SEARCH_URL,
      },
      body: new URLSearchParams({
        selectlist1: "Last",
        idoc: `${query.lastName}, ${query.firstName}`,
        submit: "Find",
      }),
    });
    if (!results.ok) throw new Error(`Illinois IDOC search failed: ${results.status}`);
    const candidates = parseIllinoisCandidates(await results.text(), query);

    return Promise.all(candidates.map(async (candidate) => {
      const detail = await fetchWithRetry(DETAIL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
          Cookie: cookie,
          Origin: "https://www.idoc.state.il.us",
          Referer: SEARCH_RESULTS_URL,
        },
        body: new URLSearchParams({ idoc: candidate.idocNumber }),
      });
      if (!detail.ok) throw new Error(`Illinois IDOC detail failed: ${detail.status}`);
      return parseIllinoisDetail(await detail.text(), candidate);
    }));
  }
}