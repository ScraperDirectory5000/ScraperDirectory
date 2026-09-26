import type { Connector, NormalizedAddress, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const DATASET_ID = "vfrr-8z5c";
const API_URL = `https://data.mo.gov/resource/${DATASET_ID}.json`;
const DATASET_URL = `https://data.mo.gov/Regulatory/Finance-Entities/${DATASET_ID}/about_data`;
const RESULT_LIMIT = 500;

interface MissouriFinanceRow {
  description?: unknown;
  name?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  zipcode?: unknown;
  phone?: unknown;
  license?: unknown;
  approval?: unknown;
  type?: unknown;
  county?: unknown;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\s+/g, " ").trim() || undefined;
}

function comparableName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function parsePersonName(value: string): { firstName: string; middleName?: string; lastName: string } | null {
  const comma = value.indexOf(",");
  if (comma < 1) return null;
  const lastName = cleanString(value.slice(0, comma));
  const givenNames = cleanString(value.slice(comma + 1))?.split(" ");
  if (!lastName || !givenNames?.[0]) return null;
  return {
    firstName: givenNames[0],
    middleName: givenNames.slice(1).join(" ") || undefined,
    lastName,
  };
}

function addressKey(address: NormalizedAddress): string {
  return [address.line1, address.city, address.state, address.zipCode]
    .map((part) => comparableName(part ?? ""))
    .join("|");
}

export function normalizeMissouriFinanceEntities(payload: unknown, query: PersonQuery): NormalizedPerson[] {
  if (!Array.isArray(payload)) return [];
  const requestedFirst = comparableName(query.firstName);
  const requestedLast = comparableName(query.lastName);
  const people = new Map<string, NormalizedPerson>();
  const addressKeys = new Map<string, Set<string>>();

  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as MissouriFinanceRow;
    const rowType = cleanString(row.type);
    const nameValue = cleanString(row.name);
    const licenseNumber = cleanString(row.license);
    const approvalId = cleanString(row.approval);
    const name = nameValue ? parsePersonName(nameValue) : null;
    if (
      rowType !== "MLO" ||
      !name ||
      !licenseNumber ||
      !approvalId ||
      comparableName(name.firstName) !== requestedFirst ||
      comparableName(name.lastName) !== requestedLast
    ) {
      continue;
    }

    const addressLine = cleanString(row.address);
    const city = cleanString(row.city);
    const holderState = cleanString(row.state);
    const zipCode = cleanString(row.zipcode);
    const county = cleanString(row.county);
    const location = [city, holderState].filter(Boolean).join(", ");
    const licenseType = cleanString(row.description) ?? "Mortgage Loan Originator";
    let person = people.get(approvalId);
    if (!person) {
      person = {
        externalId: approvalId,
        ...name,
        source: "missouri_finance_entities",
        addresses: [],
        records: [{
          caseNumber: licenseNumber,
          courtName: "Missouri Department of Insurance, Financial Institutions & Professional Registration",
          state: "MO",
          caseType: "professional_license",
          disposition: [
            "Status: Not provided by source",
            `Type: ${licenseType} (${rowType})`,
            location ? `Location: ${location}${county ? ` (${county} County)` : ""}` : null,
            `Approval ID: ${approvalId}`,
          ].filter(Boolean).join(" | "),
          sourceUrl: DATASET_URL,
        }],
      };
      people.set(approvalId, person);
      addressKeys.set(approvalId, new Set());
    }

    if (addressLine) {
      const address = { line1: addressLine, city, state: holderState, zipCode };
      const key = addressKey(address);
      if (!addressKeys.get(approvalId)?.has(key)) {
        person.addresses?.push(address);
        addressKeys.get(approvalId)?.add(key);
      }
    }
  }

  return [...people.values()];
}

export class MissouriFinanceEntitiesConnector implements Connector {
  sourceName = "missouri_finance_entities";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "MO") return [];

    const params = new URLSearchParams({
      "$select": "description,name,address,city,state,zipcode,phone,license,approval,type,county",
      "$where": "type='MLO'",
      "$q": `${query.firstName.trim()} ${query.lastName.trim()}`,
      "$order": "approval,license,name,address",
      "$limit": String(RESULT_LIMIT),
    });
    const appToken = process.env.MISSOURI_SOCRATA_APP_TOKEN;
    const response = await fetchWithRetry(`${API_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)",
        ...(appToken ? { "X-App-Token": appToken } : {}),
      },
    });
    if (!response.ok) throw new Error(`Missouri Finance Entities request failed: ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Missouri Finance Entities returned an invalid payload");
    if (payload.length >= RESULT_LIMIT) {
      throw new Error(`Missouri Finance Entities query reached the ${RESULT_LIMIT}-row safety limit`);
    }
    return normalizeMissouriFinanceEntities(payload, query);
  }
}

export { DATASET_URL as MISSOURI_FINANCE_ENTITIES_DATASET_URL };