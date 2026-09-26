import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const API_URL = "https://captorapi.cor.pa.gov/InmateLocatorAPIV8/api/v1/InmateLocator/SearchResults";
const SEARCH_URL = "https://inmatelocator.cor.pa.gov/";

interface PennsylvaniaInmate {
  inmate_number?: string;
  inm_firstname?: string;
  inm_middlename?: string;
  inm_lastname?: string;
  inm_namesuffix?: string;
  dob?: string;
  cnty_name?: string;
  fac_name?: string;
}

interface PennsylvaniaResponse {
  inmates?: PennsylvaniaInmate[];
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function yearFromDate(value: string): number | undefined {
  const match = value.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

export function parsePennsylvaniaResults(data: PennsylvaniaResponse, query: PersonQuery): NormalizedPerson[] {
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return (Array.isArray(data.inmates) ? data.inmates : []).flatMap((inmate) => {
    const externalId = clean(inmate.inmate_number);
    const firstName = clean(inmate.inm_firstname);
    const middleName = clean(inmate.inm_middlename);
    const lastName = clean(inmate.inm_lastname);
    const suffix = clean(inmate.inm_namesuffix);
    const dob = clean(inmate.dob);
    const county = clean(inmate.cnty_name);
    const facility = clean(inmate.fac_name);
    if (
      !externalId ||
      firstName.toLowerCase() !== requestedFirst ||
      lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const disposition = [
      facility ? `Facility: ${facility}` : null,
      county ? `Committing county: ${county}` : null,
      suffix ? `Suffix: ${suffix}` : null,
    ].filter(Boolean).join(" | ");
    return [{
      externalId,
      firstName,
      middleName: middleName || undefined,
      lastName,
      dobYear: yearFromDate(dob),
      source: "pennsylvania_corrections",
      records: [{
        caseNumber: externalId,
        courtName: "Pennsylvania Department of Corrections",
        state: "PA",
        caseType: "corrections_record",
        disposition: disposition || undefined,
        sourceUrl: SEARCH_URL,
      }],
    }];
  });
}

export class PennsylvaniaCorrectionsConnector implements Connector {
  sourceName = "pennsylvania_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "PA") return [];
    const response = await fetchWithRetry(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)",
      },
      body: JSON.stringify({
        id: "",
        firstName: query.firstName,
        lastName: query.lastName,
        middleName: "",
        paroleNumber: "",
        countylistkey: "---",
        citizenlistkey: "---",
        sexlistkey: "---",
        locationlistkey: "---",
        age: "",
        dateofbirth: null,
        sortBy: "1",
      }),
    });
    if (!response.ok) throw new Error(`Pennsylvania DOC search failed: ${response.status}`);
    return parsePennsylvaniaResults(await response.json() as PennsylvaniaResponse, query);
  }
}