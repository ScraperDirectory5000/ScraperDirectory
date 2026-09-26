import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const DATASET_ID = "vf3r-u4kv";
const API_URL = `https://data.vermont.gov/resource/${DATASET_ID}.json`;
const DATASET_URL = `https://data.vermont.gov/Public-Safety/DOCPublicUseFile/${DATASET_ID}/about_data`;
const RESULT_LIMIT = 500;

interface VermontRosterRow {
  offenderid?: unknown;
  offenderlastname?: unknown;
  offenderfirstname?: unknown;
  offendermiddlename?: unknown;
  bookingdate?: unknown;
  legalstatusagency?: unknown;
  legalstatusstartdate?: unknown;
  legalstatus?: unknown;
  chargestatus?: unknown;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

export function normalizeVermontRoster(payload: unknown, query: PersonQuery): NormalizedPerson[] {
  if (!Array.isArray(payload)) return [];
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();
  const people = new Map<string, NormalizedPerson>();

  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as VermontRosterRow;
    const offenderId = cleanString(row.offenderid);
    const firstName = cleanString(row.offenderfirstname);
    const lastName = cleanString(row.offenderlastname);
    const status = cleanString(row.legalstatus);
    const location = cleanString(row.legalstatusagency);
    if (
      !offenderId ||
      !firstName ||
      !lastName ||
      !status ||
      !location ||
      firstName.toLowerCase() !== requestedFirst ||
      lastName.toLowerCase() !== requestedLast ||
      people.has(offenderId)
    ) {
      continue;
    }

    const chargeStatus = cleanString(row.chargestatus);
    const disposition = [
      `Status: ${status}`,
      `Location: ${location}`,
      chargeStatus ? `Charge status: ${chargeStatus}` : null,
    ].filter(Boolean).join(" | ");
    const filingDate = cleanString(row.legalstatusstartdate) ?? cleanString(row.bookingdate);
    people.set(offenderId, {
      externalId: offenderId,
      firstName,
      middleName: cleanString(row.offendermiddlename),
      lastName,
      source: "vermont_corrections",
      records: [{
        caseNumber: offenderId,
        courtName: "Vermont Department of Corrections",
        state: "VT",
        caseType: "corrections_record",
        filingDate: filingDate?.slice(0, 10),
        disposition,
        sourceUrl: `${API_URL}?offenderid=${encodeURIComponent(offenderId)}`,
      }],
    });
  }

  return [...people.values()];
}

function soqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export class VermontCorrectionsConnector implements Connector {
  sourceName = "vermont_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "VT") return [];

    const where = [
      `upper(offenderfirstname)=${soqlLiteral(query.firstName.trim().toUpperCase())}`,
      `upper(offenderlastname)=${soqlLiteral(query.lastName.trim().toUpperCase())}`,
      "legalstatusenddate IS NULL",
    ].join(" AND ");
    const params = new URLSearchParams({
      "$select": "offenderid,offenderlastname,offenderfirstname,offendermiddlename,bookingdate,legalstatusagency,legalstatusstartdate,legalstatus,chargestatus",
      "$where": where,
      "$order": "legalstatusstartdate DESC",
      "$limit": String(RESULT_LIMIT),
    });
    const appToken = process.env.VERMONT_SOCRATA_APP_TOKEN;
    const response = await fetchWithRetry(`${API_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)",
        ...(appToken ? { "X-App-Token": appToken } : {}),
      },
    });
    if (!response.ok) throw new Error(`Vermont DOC public data request failed: ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Vermont DOC public data returned an invalid payload");
    if (payload.length >= RESULT_LIMIT) {
      throw new Error(`Vermont DOC exact-name query reached the ${RESULT_LIMIT}-row safety limit`);
    }
    return normalizeVermontRoster(payload, query);
  }
}

export { DATASET_URL as VERMONT_DOC_DATASET_URL };