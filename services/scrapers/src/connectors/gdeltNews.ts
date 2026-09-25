import type { Connector, NormalizedCourtRecord, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";
import { classifyNewsMention, newsIdentity, STATE_NAMES } from "./newsRecords.js";

const BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const EVENT_TERMS = "(obituary OR obituaries OR died OR funeral OR birth OR births OR arrested OR charged OR indicted OR convicted OR sentenced)";
const REQUEST_INTERVAL_MS = 5_500;

interface GdeltResponse {
  articles?: Array<{
    url?: string;
    title?: string;
    seendate?: string;
    domain?: string;
    sourcecountry?: string;
  }>;
}

function publicationDate(seenDate?: string): string | undefined {
  const match = seenDate?.match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export class GdeltNewsConnector implements Connector {
  sourceName = "gdelt_news";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    const exactName = `"${query.firstName} ${query.lastName}"`;
    const queries = [
      `${exactName} sourcecountry:US sourcelang:english`,
      `${exactName} ${EVENT_TERMS} sourcecountry:US sourcelang:english`,
    ];
    const stateName = query.state ? STATE_NAMES[query.state] : undefined;
    if (stateName) queries.push(`${exactName} "${stateName}" sourcecountry:US sourcelang:english`);

    const records = new Map<string, NormalizedCourtRecord>();
    for (const [index, searchQuery] of queries.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
      const params = new URLSearchParams({
        query: searchQuery,
        mode: "artlist",
        maxrecords: "250",
        format: "json",
        sort: "datedesc",
        timespan: "3months",
      });
      const response = await fetchWithRetry(`${BASE_URL}?${params.toString()}`, {
        headers: { "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)" },
      });
      if (!response.ok) throw new Error(`GDELT request failed: ${response.status}`);
      const body = (await response.json()) as GdeltResponse;

      for (const article of body.articles ?? []) {
        if (!article.url || records.has(article.url)) continue;
        const title = article.title?.replace(/\s+/g, " ").trim() || "News article mentioning searched name";
        records.set(article.url, {
          courtName: article.domain ?? article.sourcecountry ?? "GDELT indexed news source",
          state: stateName && searchQuery.includes(`"${stateName}"`) ? query.state : undefined,
          caseType: classifyNewsMention(title, `${query.firstName} ${query.lastName}`),
          filingDate: publicationDate(article.seendate),
          disposition: title,
          sourceUrl: article.url,
        });
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