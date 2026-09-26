import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const BASE_URL = "https://docpub.state.or.us";
const DISCLAIMER_URL = `${BASE_URL}/OOS/intro.jsf`;
const SEARCH_URL = `${BASE_URL}/OOS/searchCriteria.jsf`;
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";

interface OregonSearchResult {
  sid: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  dobYear?: number;
  detailCommand: string;
}

function decodeText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hiddenValue(html: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`name=["']${escapedName}["'][^>]*value=["']([^"']*)`, "i"))?.[1];
}

function formAction(html: string): string | undefined {
  return html.match(/<form\b[^>]*action=["']([^"']+)/i)?.[1].replace(/&amp;/gi, "&");
}

function updateCookies(cookies: Map<string, string>, response: Response): void {
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function parseOregonSearchResults(html: string, query: PersonQuery): OregonSearchResult[] {
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();
  const results = new Map<string, OregonSearchResult>();

  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => decodeText(cell[1]));
    if (cells.length !== 5) continue;
    const [sid, firstName, middleName, lastName, dob] = cells;
    const detailCommand = row[1].match(/value=["'](mainBodyForm:foundOffenders:\d+:j_id\d+)["']/i)?.[1];
    if (
      !/^\d+$/.test(sid) ||
      !detailCommand ||
      firstName.toLowerCase() !== requestedFirst ||
      lastName.toLowerCase() !== requestedLast ||
      results.has(sid)
    ) {
      continue;
    }
    const dobYear = Number.parseInt(dob.match(/(\d{4})$/)?.[1] ?? "", 10);
    results.set(sid, {
      sid,
      firstName,
      middleName: middleName || undefined,
      lastName,
      dobYear: Number.isInteger(dobYear) ? dobYear : undefined,
      detailCommand,
    });
  }

  return [...results.values()];
}

export function normalizeOregonDetail(html: string, result: OregonSearchResult): NormalizedPerson {
  const text = decodeText(html);
  const sid = text.match(/\bSID#\s*(\d+)/i)?.[1];
  if (sid !== result.sid) throw new Error(`Oregon OOS detail SID did not match ${result.sid}`);

  const location = text.match(/\bLocation:\s*(.*?)\s+Gender:/i)?.[1];
  const status = text.match(/\bStatus:\s*(.*?)\s+Height:/i)?.[1];
  const disposition = [
    status ? `Status: ${status}` : null,
    location ? `Location: ${location}` : null,
  ].filter(Boolean).join(" | ");

  return {
    externalId: result.sid,
    firstName: result.firstName,
    middleName: result.middleName,
    lastName: result.lastName,
    dobYear: result.dobYear,
    source: "oregon_corrections",
    records: [{
      caseNumber: result.sid,
      courtName: "Oregon Department of Corrections",
      state: "OR",
      caseType: "corrections_record",
      disposition: disposition || undefined,
      sourceUrl: DISCLAIMER_URL,
    }],
  };
}

export class OregonCorrectionsConnector implements Connector {
  sourceName = "oregon_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "OR") return [];

    const cookies = new Map<string, string>();
    const request = async (url: string | URL, init: RequestInit = {}): Promise<Response> => {
      const response = await fetchWithRetry(url.toString(), {
        ...init,
        headers: {
          "User-Agent": USER_AGENT,
          ...(cookies.size > 0 ? { Cookie: cookieHeader(cookies) } : {}),
          ...init.headers,
        },
      });
      updateCookies(cookies, response);
      return response;
    };

    const disclaimer = await request(DISCLAIMER_URL);
    if (!disclaimer.ok) throw new Error(`Oregon OOS disclaimer failed: ${disclaimer.status}`);
    const disclaimerHtml = await disclaimer.text();
    const disclaimerViewState = hiddenValue(disclaimerHtml, "javax.faces.ViewState");
    const disclaimerAction = formAction(disclaimerHtml);
    if (!disclaimerViewState || !disclaimerAction) throw new Error("Oregon OOS disclaimer form was incomplete");

    const accepted = await request(new URL(disclaimerAction, DISCLAIMER_URL), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        disclaimerForm: "disclaimerForm",
        "disclaimerForm:btnAgree": "I Agree",
        "javax.faces.ViewState": disclaimerViewState,
      }),
    });
    if (!accepted.ok) throw new Error(`Oregon OOS disclaimer acceptance failed: ${accepted.status}`);
    const searchFormHtml = await accepted.text();
    const searchViewState = hiddenValue(searchFormHtml, "javax.faces.ViewState");
    if (!searchViewState) throw new Error("Oregon OOS search ViewState was not found");

    const searchFields = {
      mainBodyForm: "mainBodyForm",
      "mainBodyForm:FirstName": query.firstName.trim(),
      "mainBodyForm:MiddleName": "",
      "mainBodyForm:LastName": query.lastName.trim(),
      "mainBodyForm:SidNumber": "",
      "javax.faces.ViewState": searchViewState,
    };
    const searched = await request(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: accepted.url },
      body: new URLSearchParams({ ...searchFields, "mainBodyForm:sendQuery": "Search" }),
    });
    if (!searched.ok) throw new Error(`Oregon OOS search failed: ${searched.status}`);
    const resultsHtml = await searched.text();
    const results = parseOregonSearchResults(resultsHtml, query);
    const resultsViewState = hiddenValue(resultsHtml, "javax.faces.ViewState");
    if (results.length > 0 && !resultsViewState) throw new Error("Oregon OOS result ViewState was not found");

    const people: NormalizedPerson[] = [];
    for (const result of results) {
      const detail = await request(SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: searched.url },
        body: new URLSearchParams({
          ...searchFields,
          "mainBodyForm:j_idcl": result.detailCommand,
          "javax.faces.ViewState": resultsViewState as string,
        }),
      });
      if (!detail.ok) throw new Error(`Oregon OOS detail failed for SID ${result.sid}: ${detail.status}`);
      people.push(normalizeOregonDetail(await detail.text(), result));
    }
    return people;
  }
}