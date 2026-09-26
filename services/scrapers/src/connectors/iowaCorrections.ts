import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const SEARCH_URL = "https://doc-search.iowa.gov/Offender/Search";
const API_URL = "https://doc-search.iowa.gov/api/offender/GetOffenderListAjax";
const DETAIL_URL = "https://doc-search.iowa.gov/offender/detail";
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";

interface IowaResult {
  Name?: string;
  OffenderNumber?: string;
  Gender?: string;
  Age?: number;
}

interface IowaResponse {
  data?: IowaResult[];
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

function parseName(value: string): { firstName: string; middleName?: string; lastName: string } | null {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : undefined,
    lastName: parts.at(-1) as string,
  };
}

export function exactIowaResults(results: IowaResult[], query: PersonQuery): IowaResult[] {
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();
  return results.filter((result) => {
    const name = result.Name ? parseName(result.Name) : null;
    return Boolean(
      result.OffenderNumber?.trim() &&
      name?.firstName.toLowerCase() === requestedFirst &&
      name.lastName.toLowerCase() === requestedLast
    );
  });
}

function labeledValue(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`${escaped}:?\\s*<\\/[^>]+>\\s*<[^>]+>([\\s\\S]*?)<\\/[^>]+>`, "i"));
  return match ? plainText(match[1]) || undefined : undefined;
}

export function parseIowaDetail(html: string, result: IowaResult): NormalizedPerson {
  const name = parseName(result.Name ?? "");
  if (!name) throw new Error("Iowa DOC detail result did not contain a valid name");
  const offenderNumber = result.OffenderNumber?.trim();
  if (!offenderNumber) throw new Error("Iowa DOC detail result did not contain an offender number");

  const location = labeledValue(html, "Location");
  const charges = html.match(/<table\b[^>]*id="charges"[^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? "";
  const statuses = [...charges.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((row) => {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => plainText(cell[1]));
    return cells[1] ? [cells[1]] : [];
  });
  const disposition = [
    location ? `Location: ${location}` : null,
    statuses.length ? `Supervision: ${[...new Set(statuses)].join(", ")}` : null,
  ].filter(Boolean).join(" | ");

  return {
    externalId: offenderNumber,
    firstName: name.firstName,
    middleName: name.middleName,
    lastName: name.lastName,
    source: "iowa_corrections",
    records: [{
      caseNumber: offenderNumber,
      courtName: "Iowa Department of Corrections",
      state: "IA",
      caseType: "corrections_record",
      disposition: disposition || undefined,
      sourceUrl: `${DETAIL_URL}?${new URLSearchParams({ offenderNumber }).toString()}`,
    }],
  };
}

function dataTableForm(query: PersonQuery): URLSearchParams {
  const form = new URLSearchParams({
    draw: "1",
    start: "0",
    length: "100",
    "search[value]": "",
    "search[regex]": "false",
    "order[0][column]": "0",
    "order[0][dir]": "asc",
    "searchModel.FirsName": query.firstName,
    "searchModel.MiddleName": "",
    "searchModel.LastName": query.lastName,
    "searchModel.OffenderNumber": "",
    "searchModel.Gender": "",
    "searchModel.Location": "",
    "searchModel.Offense": "",
    "searchModel.County": "",
    "searchModel.SearchType": "SW",
  });
  for (const [index, name] of ["Name", "OffenderNumber", "Age", "Gender"].entries()) {
    form.set(`columns[${index}][data]`, name);
    form.set(`columns[${index}][name]`, name);
    form.set(`columns[${index}][searchable]`, "true");
    form.set(`columns[${index}][orderable]`, "true");
    form.set(`columns[${index}][search][value]`, "");
    form.set(`columns[${index}][search][regex]`, "false");
  }
  return form;
}

export class IowaCorrectionsConnector implements Connector {
  sourceName = "iowa_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "IA") return [];

    const initial = await fetchWithRetry(SEARCH_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!initial.ok) throw new Error(`Iowa DOC search page failed: ${initial.status}`);
    const initialHtml = await initial.text();
    const token = initialHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i)?.[1];
    const cookie = cookieHeader(initial);
    if (!token || !cookie) throw new Error("Iowa DOC anti-forgery session was not provided");

    const search = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Cookie: cookie,
        Origin: "https://doc-search.iowa.gov",
        Referer: SEARCH_URL,
      },
      body: new URLSearchParams({
        "search.FirsName": query.firstName,
        "search.MiddleName": "",
        "search.LastName": query.lastName,
        "search.OffenderNumber": "",
        "search.Gender": "",
        "search.Location": "",
        "search.Offense": "",
        "search.County": "",
        "search.SearchType": "SW",
        __RequestVerificationToken: token,
      }),
    });
    if (!search.ok) throw new Error(`Iowa DOC search failed: ${search.status}`);

    const response = await fetchWithRetry(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookie,
        Origin: "https://doc-search.iowa.gov",
        Referer: search.url,
      },
      body: dataTableForm(query),
    });
    if (!response.ok) throw new Error(`Iowa DOC results failed: ${response.status}`);
    const body = (await response.json()) as IowaResponse;
    const matches = exactIowaResults(body.data ?? [], query);

    return Promise.all(matches.map(async (result) => {
      const offenderNumber = result.OffenderNumber?.trim() as string;
      const detailUrl = `${DETAIL_URL}?${new URLSearchParams({ offenderNumber }).toString()}`;
      const detail = await fetchWithRetry(detailUrl, {
        headers: { "User-Agent": USER_AGENT, Cookie: cookie, Referer: search.url },
      });
      if (!detail.ok) throw new Error(`Iowa DOC detail failed: ${detail.status}`);
      return parseIowaDetail(await detail.text(), result);
    }));
  }
}