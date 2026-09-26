import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { readBoundedText } from "./boundedResponse.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const DEMOGRAPHIC_URL = "https://ofdsearch.doc.nv.gov/download_offender_data/demographic.csv";
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;

function clean(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function parseTsvRow(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "\t" && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

export function parseNevadaDemographics(data: string, query: PersonQuery): NormalizedPerson[] {
  const lines = data.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];

  const headers = parseTsvRow(lines[0]).map((header) => header.replace(/^\uFEFF/, "").trim());
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return lines.slice(1).flatMap((line) => {
    const fields = parseTsvRow(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, clean(fields[index])]));
    const firstName = row.first_name;
    const lastName = row.last_name;
    const offenderId = row.offender_id;
    if (
      !firstName ||
      !lastName ||
      !offenderId ||
      firstName.toLowerCase() !== requestedFirst ||
      lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const disposition = [
      row.agy_loc_id ? `Status/location: ${row.agy_loc_id}` : null,
      row.sec_level ? `Security level: ${row.sec_level}` : null,
      row.pri_fel_flag ? `Primary felony: ${row.pri_fel_flag}` : null,
      row.gender ? `Gender: ${row.gender}` : null,
    ].filter(Boolean).join(" | ");

    return [{
      externalId: offenderId,
      firstName,
      middleName: row.middle_name,
      lastName,
      source: "nevada_corrections",
      records: [{
        caseNumber: offenderId,
        courtName: "Nevada Department of Corrections",
        state: "NV",
        caseType: "corrections_record",
        disposition: disposition || undefined,
        sourceUrl: DEMOGRAPHIC_URL,
      }],
    }];
  });
}

export class NevadaCorrectionsConnector implements Connector {
  sourceName = "nevada_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "NV") return [];

    const response = await fetchWithRetry(DEMOGRAPHIC_URL, {
      headers: {
        Accept: "text/csv",
        "Accept-Encoding": "identity",
        "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)",
      },
    });
    if (!response.ok) throw new Error(`Nevada NDOC download failed: ${response.status}`);
    const data = await readBoundedText(response, MAX_DOWNLOAD_BYTES, "Nevada NDOC");
    return parseNevadaDemographics(data, query);
  }
}