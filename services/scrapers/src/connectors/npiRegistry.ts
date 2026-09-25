import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";

/** NPI Registry — free public API for U.S. healthcare provider directory data.
 * No auth, no rate-limit key required. Docs: https://npiregistry.cms.hhs.gov/api-page */
const BASE_URL = "https://npiregistry.cms.hhs.gov/api/";

interface NpiAddress {
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  telephone_number?: string;
  address_purpose?: string;
}

interface NpiResult {
  number: string;
  basic: { first_name?: string; last_name?: string; middle_name?: string; enumeration_date?: string; credential?: string };
  addresses?: NpiAddress[];
  other_names?: Array<{ first_name?: string; last_name?: string; middle_name?: string }>;
  taxonomies?: Array<{ code?: string; desc?: string; license?: string; state?: string; primary?: boolean }>;
}

interface NpiResponse {
  result_count: number;
  results?: NpiResult[];
}

export class NpiRegistryConnector implements Connector {
  sourceName = "npi_registry";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    const params = new URLSearchParams({
      version: "2.1",
      first_name: query.firstName,
      last_name: query.lastName,
      limit: "200",
    });
    if (query.state) params.set("state", query.state);

    const response = await fetch(`${BASE_URL}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`NPI registry request failed: ${response.status}`);
    }
    const body = (await response.json()) as NpiResponse;

    const requestedFirst = query.firstName.toLowerCase();
    const requestedLast = query.lastName.toLowerCase();

    return (body.results ?? []).flatMap((result) => {
      const names = [result.basic, ...(result.other_names ?? [])];
      const matchedName = names.find(
        (name) =>
          name.first_name?.toLowerCase() === requestedFirst && name.last_name?.toLowerCase() === requestedLast
      );
      if (!matchedName) return [];

      const primaryTaxonomy = result.taxonomies?.find((taxonomy) => taxonomy.primary) ?? result.taxonomies?.[0];
      return [{
        externalId: result.number,
        firstName: matchedName.first_name ?? query.firstName,
        middleName: matchedName.middle_name,
        lastName: matchedName.last_name ?? query.lastName,
        source: this.sourceName,
        addresses: (result.addresses ?? []).map((addr) => ({
          line1: addr.address_1 ?? "",
          line2: addr.address_2,
          city: addr.city,
          state: addr.state,
          zipCode: addr.postal_code,
        })),
        phones: (result.addresses ?? [])
          .filter((addr) => addr.telephone_number)
          .map((addr) => ({ number: addr.telephone_number as string, phoneType: "landline" as const })),
        records: [{
          caseNumber: result.number,
          courtName: primaryTaxonomy?.desc ?? result.basic.credential ?? "National Provider Identifier",
          state: primaryTaxonomy?.state,
          caseType: "professional_license",
          filingDate: result.basic.enumeration_date,
          disposition: primaryTaxonomy?.license ? `License ${primaryTaxonomy.license}` : primaryTaxonomy?.code,
          sourceUrl: `https://npiregistry.cms.hhs.gov/provider-view/${result.number}`,
        }],
      }];
    });
  }
}
