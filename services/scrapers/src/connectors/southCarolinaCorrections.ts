import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const SEARCH_URL = "https://public.doc.state.sc.us/scdc-public/inmateSearch.do";

interface SouthCarolinaInmate {
  scdcId?: string;
  fname?: string;
  mname?: string;
  lname?: string;
  dateOfBirth?: string;
  age?: string;
  institution?: string;
  race?: string;
  sex?: string;
  offense?: string;
  projMaxoutDate?: string;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function yearFromDate(value: string): number | undefined {
  const match = value.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

export function parseSouthCarolinaResults(data: SouthCarolinaInmate[], query: PersonQuery): NormalizedPerson[] {
  if (!Array.isArray(data)) return [];
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return data.flatMap((inmate) => {
    const externalId = clean(inmate.scdcId);
    const firstName = clean(inmate.fname);
    const middleName = clean(inmate.mname);
    const lastName = clean(inmate.lname);
    const dateOfBirth = clean(inmate.dateOfBirth);
    const age = clean(inmate.age);
    const institution = clean(inmate.institution);
    const race = clean(inmate.race);
    const sex = clean(inmate.sex);
    const offense = clean(inmate.offense);
    const projectedMaxout = clean(inmate.projMaxoutDate);
    if (
      !externalId ||
      firstName.toLowerCase() !== requestedFirst ||
      lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const disposition = [
      institution ? `Institution: ${institution}` : null,
      offense ? `Offense: ${offense}` : null,
      projectedMaxout ? `Projected maxout: ${projectedMaxout}` : null,
      age ? `Age: ${age}` : null,
      race ? `Race: ${race}` : null,
      sex ? `Sex: ${sex}` : null,
    ].filter(Boolean).join(" | ");
    return [{
      externalId,
      firstName,
      middleName: middleName || undefined,
      lastName,
      dobYear: yearFromDate(dateOfBirth),
      source: "south_carolina_corrections",
      records: [{
        caseNumber: externalId,
        courtName: "South Carolina Department of Corrections",
        state: "SC",
        caseType: "corrections_record",
        disposition: disposition || undefined,
        sourceUrl: SEARCH_URL,
      }],
    }];
  });
}

export class SouthCarolinaCorrectionsConnector implements Connector {
  sourceName = "south_carolina_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "SC") return [];
    const params = new URLSearchParams({
      lastName: query.lastName,
      firstName: query.firstName,
      scdcId: "",
      sid: "",
      phoneticMatch: "false",
    });
    const response = await fetchWithRetry(`${SEARCH_URL}?${params.toString()}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)",
      },
    });
    if (!response.ok) throw new Error(`South Carolina DOC search failed: ${response.status}`);
    return parseSouthCarolinaResults(await response.json() as SouthCarolinaInmate[], query);
  }
}