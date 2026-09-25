import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";

/** SEC EDGAR full-text search — free public API covering business filings that
 * mention a name (officers, directors, registered agents, etc.).
 * SEC requires a descriptive User-Agent with contact info on every request:
 * https://www.sec.gov/os/webmaster-faq#developers — set SEC_EDGAR_USER_AGENT env var. */
const BASE_URL = "https://efts.sec.gov/LATEST/search-index";

interface EdgarHit {
  _source: {
    display_names?: string[];
    file_date?: string;
    form?: string;
    adsh?: string; // accession number, e.g. "0000950134-06-005346"
    ciks?: string[];
  };
  _id: string; // "{adsh}:{filename}"
}

interface EdgarResponse {
  hits: { hits: EdgarHit[] };
}

export class SecEdgarConnector implements Connector {
  sourceName = "sec_edgar";

  private userAgent: string;

  constructor(userAgent = process.env.SEC_EDGAR_USER_AGENT ?? "unnamedfiles-dev contact@example.com") {
    this.userAgent = userAgent;
  }

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    const q = `"${query.firstName} ${query.lastName}"`;
    const params = new URLSearchParams({ q });

    const response = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: { "User-Agent": this.userAgent },
    });
    if (!response.ok) {
      throw new Error(`SEC EDGAR request failed: ${response.status}`);
    }
    const body = (await response.json()) as EdgarResponse;

    return body.hits.hits.map((hit) => {
      const cik = hit._source.ciks?.[0]?.replace(/^0+/, "");
      const accessionNoDashes = hit._source.adsh?.replace(/-/g, "");
      const filename = hit._id.split(":")[1];
      const sourceUrl =
        cik && accessionNoDashes && filename
          ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/${filename}`
          : undefined;

      return {
        firstName: query.firstName,
        lastName: query.lastName,
        source: this.sourceName,
        records: [
          {
            caseType: "business_filing",
            courtName: hit._source.display_names?.join(", "),
            filingDate: hit._source.file_date,
            disposition: hit._source.form,
            sourceUrl,
          },
        ],
      };
    });
  }
}
