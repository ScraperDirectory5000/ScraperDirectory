import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const BASE_URL = "https://api.open.fec.gov/v1/schedules/schedule_a/";

interface FecContribution {
  sub_id?: string;
  contributor_name?: string;
  contributor_state?: string;
  contributor_zip?: string;
  contributor_employer?: string;
  contributor_occupation?: string;
  contribution_receipt_date?: string;
  contribution_receipt_amount?: number;
  committee_id?: string;
  image_number?: string;
}

interface FecResponse {
  results?: FecContribution[];
}

const IGNORED_NAME_PARTS = new Set(["MR", "MRS", "MS", "DR", "JR", "SR", "II", "III", "IV"]);

function parseContributorName(name: string): { firstName: string; middleName?: string; lastName: string } | null {
  const [lastPart, givenPart] = name.toUpperCase().split(",", 2);
  if (!lastPart || !givenPart) return null;
  const lastName = lastPart.replace(/[^A-Z'-]/g, "").trim();
  const given = givenPart
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Z'-]/g, ""))
    .filter((part) => part && !IGNORED_NAME_PARTS.has(part));
  if (!lastName || given.length === 0) return null;
  return { firstName: given[0], middleName: given.slice(1).join(" ") || undefined, lastName };
}

export class FecContributionsConnector implements Connector {
  sourceName = "fec_contributions";

  constructor(private readonly apiKey = process.env.FEC_API_KEY ?? "DEMO_KEY") {}

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      contributor_name: `${query.firstName} ${query.lastName}`,
      per_page: "100",
      sort: "-contribution_receipt_date",
    });
    if (query.state) params.set("contributor_state", query.state);

    const response = await fetchWithRetry(`${BASE_URL}?${params.toString()}`);
    if (!response.ok) throw new Error(`FEC API request failed: ${response.status}`);
    const body = (await response.json()) as FecResponse;
    const requestedFirst = query.firstName.toUpperCase();
    const requestedLast = query.lastName.toUpperCase();

    return (body.results ?? []).flatMap((contribution) => {
      const parsed = contribution.contributor_name ? parseContributorName(contribution.contributor_name) : null;
      if (!parsed || parsed.firstName !== requestedFirst || parsed.lastName !== requestedLast) return [];

      const identityParts = [
        parsed.firstName,
        parsed.middleName ?? "",
        parsed.lastName,
        contribution.contributor_zip?.slice(0, 5) ?? "",
      ];
      const detail = [
        contribution.contribution_receipt_amount != null
          ? `$${contribution.contribution_receipt_amount.toFixed(2)}`
          : null,
        contribution.contributor_employer,
        contribution.contributor_occupation,
      ].filter(Boolean).join(" | ");

      return [{
        externalId: identityParts.join("|").toLowerCase(),
        firstName: parsed.firstName,
        middleName: parsed.middleName,
        lastName: parsed.lastName,
        source: this.sourceName,
        records: [{
          caseNumber: contribution.sub_id,
          courtName: contribution.committee_id ? `FEC committee ${contribution.committee_id}` : "Federal Election Commission",
          state: contribution.contributor_state,
          caseType: "campaign_contribution",
          filingDate: contribution.contribution_receipt_date?.slice(0, 10),
          disposition: detail || undefined,
          sourceUrl: contribution.image_number
            ? `https://docquery.fec.gov/cgi-bin/fecimg/?${contribution.image_number}`
            : undefined,
        }],
      }];
    });
  }
}