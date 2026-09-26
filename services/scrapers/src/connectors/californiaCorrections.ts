import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const API_URL = "https://ciris.mt.cdcr.ca.gov/api/ciris/v1/incarceratedpersons";
const SEARCH_URL = "https://ciris.mt.cdcr.ca.gov/";

interface CirisPerson {
  cdcrNumber?: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  age?: number;
  admissionDate?: string;
  location?: string;
  commitmentCounties?: string[];
}

interface CirisResponse {
  data?: CirisPerson[];
}

export function normalizeCirisResults(results: CirisPerson[], query: PersonQuery): NormalizedPerson[] {
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return results.flatMap((result) => {
    if (
      !result.cdcrNumber ||
      result.firstName?.trim().toLowerCase() !== requestedFirst ||
      result.lastName?.trim().toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const detail = [
      result.location ? `Location: ${result.location}` : null,
      result.commitmentCounties?.length ? `Commitment counties: ${result.commitmentCounties.join(", ")}` : null,
    ].filter(Boolean).join(" | ");
    return [{
      externalId: result.cdcrNumber,
      firstName: result.firstName,
      middleName: result.middleName || undefined,
      lastName: result.lastName,
      source: "california_corrections",
      records: [{
        caseNumber: result.cdcrNumber,
        courtName: "California Department of Corrections and Rehabilitation",
        state: "CA",
        caseType: "corrections_record",
        filingDate: result.admissionDate?.slice(0, 10),
        disposition: detail || undefined,
        sourceUrl: SEARCH_URL,
      }],
    }];
  });
}

export class CaliforniaCorrectionsConnector implements Connector {
  sourceName = "california_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "CA") return [];

    const params = new URLSearchParams({
      lastName: query.lastName,
      firstName: query.firstName,
      "$limit": "20",
      "$skip": "0",
      "$sort[fullName]": "1",
    });
    const response = await fetchWithRetry(`${API_URL}?${params.toString()}`, {
      headers: { "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)" },
    });
    if (!response.ok) throw new Error(`California CDCR search failed: ${response.status}`);
    const body = (await response.json()) as CirisResponse;
    return normalizeCirisResults(body.data ?? [], query);
  }
}