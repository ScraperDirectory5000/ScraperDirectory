import type { Connector, NormalizedCourtRecord, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";
import { classifyNewsMention, newsIdentity, STATE_NAMES } from "./newsRecords.js";

const BASE_URL = "https://www.loc.gov/newspapers/";
const PAGE_SIZE = 300;
const MAX_PAGES = 1;

interface LocNewspaperPage {
  results?: Array<{
    id?: string;
    title?: string;
    date?: string;
    description?: string[];
    location_state?: string[];
    partof_title?: string[];
    url?: string;
  }>;
}

export class LocNewspapersConnector implements Connector {
  sourceName = "loc_newspapers";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    const records = new Map<string, NormalizedCourtRecord>();
    const stateName = query.state ? STATE_NAMES[query.state] : undefined;
    const scopes = stateName ? [stateName, undefined] : [undefined];

    for (const scope of scopes) {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          fo: "json",
          at: "results",
          c: String(PAGE_SIZE),
          sp: String(page),
          q: `"${query.firstName} ${query.lastName}"`,
        });
        if (scope) params.set("fa", `location_state:${scope}`);

        const response = await fetchWithRetry(`${BASE_URL}?${params.toString()}`, {
          headers: { "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)" },
        });
        if (!response.ok) throw new Error(`Library of Congress request failed: ${response.status}`);
        const body = (await response.json()) as LocNewspaperPage;
        const results = body.results ?? [];

        for (const result of results) {
          const recordUrl = result.url ?? result.id;
          if (!recordUrl || records.has(recordUrl)) continue;
          const summary = result.description?.find(Boolean)?.replace(/\s+/g, " ").trim();
          const publication = result.partof_title?.[0] ?? result.title ?? "Library of Congress newspaper archive";
          const context = [result.title, summary].filter(Boolean).join(" | ");
          records.set(recordUrl, {
            caseNumber: result.id,
            courtName: publication,
            state: scope ? query.state : undefined,
            caseType: classifyNewsMention(context, `${query.firstName} ${query.lastName}`),
            filingDate: result.date,
            disposition: context.slice(0, 1_000) || undefined,
            sourceUrl: recordUrl,
          });
        }

        if (results.length < PAGE_SIZE) break;
      }
    }

    if (records.size === 0) return [];
    return [{
      externalId: newsIdentity(query),
      firstName: query.firstName,
      lastName: query.lastName,
      source: this.sourceName,
      records: [...records.values()],
    }];
  }
}