import { randomUUID } from "node:crypto";
import pg from "pg";
import type { BulkPersonRow, BulkSource } from "./types.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const STAGE_BATCH_SIZE = 1_000;

export interface BulkImportResult {
  source: string;
  status: "complete" | "unchanged";
  sourceRows: number;
  acceptedRows: number;
  rejectedRows: number;
  datasetVersion: string;
}

export function buildStagePayload(rows: BulkPersonRow[], sourceUrl: string): object[] {
  return rows.map((row) => {
    const record = row.publicRecord ?? (row.credential ? {
      type: "professional_license",
      title: row.credential.name,
      number: row.credential.number ?? row.credential.fullCode,
      status: row.credential.status,
      startDate: row.credential.issueDate,
      endDate: row.credential.expirationDate,
    } : undefined);
    if (!record) throw new Error(`${row.source} bulk row ${row.sourceRecordId} has no public record`);
    return {
    person_id: randomUUID(),
    external_id: row.personExternalId ?? row.sourceRecordId,
    source_record_id: row.sourceRecordId,
    first_name: row.firstName,
    middle_name: row.middleName ?? null,
    last_name: row.lastName,
    dob_year: row.dobYear ?? null,
    address: row.address?.street ?? null,
    city: row.address?.city ?? null,
    state: row.address?.state ?? null,
    zip_code: row.address?.zip?.slice(0, 10) ?? null,
    record_number: record.number ?? null,
    record_type: record.type,
    record_title: record.title,
    record_status: record.status,
    record_description: record.description ?? null,
    start_date: record.startDate ?? null,
    end_date: record.endDate ?? null,
    source_url: sourceUrl,
    };
  });
}

async function stageRows(client: pg.PoolClient, runId: string, rows: BulkPersonRow[], sourceUrl: string): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += STAGE_BATCH_SIZE) {
    const payload = buildStagePayload(rows.slice(offset, offset + STAGE_BATCH_SIZE), sourceUrl);
    await client.query(
      `INSERT INTO bulk_person_staging
         (run_id, person_id, external_id, source_record_id, first_name, middle_name, last_name, dob_year,
          address, city, state, zip_code, record_number, record_type, record_title, record_status,
          record_description, start_date, end_date, source_url)
       SELECT $1, item.person_id, item.external_id, item.source_record_id, item.first_name, item.middle_name,
              item.last_name, item.dob_year, item.address, item.city, item.state, item.zip_code,
              item.record_number, item.record_type, item.record_title, item.record_status,
              item.record_description, item.start_date, item.end_date, item.source_url
       FROM jsonb_to_recordset($2::jsonb) AS item(
         person_id uuid, external_id varchar, source_record_id varchar, first_name varchar, middle_name varchar,
         last_name varchar, dob_year integer, address varchar, city varchar, state varchar, zip_code varchar,
         record_number varchar, record_type varchar, record_title varchar, record_status varchar,
         record_description text, start_date date, end_date date, source_url text
       )
       ON CONFLICT (run_id, source_record_id) DO UPDATE SET
         external_id = EXCLUDED.external_id, first_name = EXCLUDED.first_name,
         middle_name = EXCLUDED.middle_name, last_name = EXCLUDED.last_name, dob_year = EXCLUDED.dob_year,
         address = EXCLUDED.address, city = EXCLUDED.city, state = EXCLUDED.state, zip_code = EXCLUDED.zip_code,
         record_number = EXCLUDED.record_number, record_type = EXCLUDED.record_type,
         record_title = EXCLUDED.record_title, record_status = EXCLUDED.record_status,
         record_description = EXCLUDED.record_description, start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date, source_url = EXCLUDED.source_url`,
      [runId, JSON.stringify(payload)]
    );
  }
}

async function publishRun(client: pg.PoolClient, runId: string, source: string): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(
      `UPDATE bulk_person_staging staged SET person_id = grouped.person_id
       FROM (
         SELECT external_id, min(person_id::text)::uuid AS person_id
         FROM bulk_person_staging WHERE run_id = $1 GROUP BY external_id
       ) grouped
       WHERE staged.run_id = $1 AND staged.external_id = grouped.external_id`,
      [runId]
    );
    await client.query(
      `UPDATE bulk_person_staging staged
       SET person_id = identities.person_id
       FROM person_source_identities identities
       WHERE staged.run_id = $1 AND identities.source = $2
         AND identities.external_id = staged.external_id`,
      [runId, source]
    );
    await client.query(
      `INSERT INTO persons (id, first_name, middle_name, last_name, dob_year, is_active, created_at, updated_at)
       SELECT DISTINCT ON (person_id) person_id, first_name, middle_name, last_name, dob_year, true, now(), now()
       FROM bulk_person_staging WHERE run_id = $1 ORDER BY person_id, source_record_id
       ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, middle_name = EXCLUDED.middle_name,
         last_name = EXCLUDED.last_name, dob_year = coalesce(EXCLUDED.dob_year, persons.dob_year),
         is_active = true, updated_at = now()`,
      [runId]
    );
    await client.query(
      `INSERT INTO person_source_identities (id, person_id, source, external_id)
      SELECT DISTINCT ON (external_id) gen_random_uuid(), person_id, $2, external_id
      FROM bulk_person_staging WHERE run_id = $1 ORDER BY external_id, source_record_id
       ON CONFLICT (source, external_id) DO NOTHING`,
      [runId, source]
    );
    await client.query(
      `UPDATE persons SET is_active = false, updated_at = now()
       WHERE id IN (
         SELECT identities.person_id FROM person_source_identities identities
         WHERE identities.source = $2 AND NOT EXISTS (
           SELECT 1 FROM bulk_person_staging staged
           WHERE staged.run_id = $1 AND staged.external_id = identities.external_id
         )
       ) AND NOT EXISTS (
         SELECT 1 FROM person_source_identities other
         WHERE other.person_id = persons.id AND other.source <> $2
       )`,
      [runId, source]
    );
    await client.query(
      `DELETE FROM addresses WHERE source = $1 AND person_id IN (
        SELECT person_id FROM person_source_identities WHERE source = $1
       )`,
      [source]
    );
    await client.query(
      `DELETE FROM court_records WHERE source = $1 AND person_id IN (
        SELECT person_id FROM person_source_identities WHERE source = $1
       )`,
      [source]
    );
    await client.query(
      `INSERT INTO addresses (id, person_id, line1, city, state, zip_code, source)
       SELECT gen_random_uuid(), person_id, address, city, state, zip_code, $2
       FROM bulk_person_staging WHERE run_id = $1 AND address IS NOT NULL`,
      [runId, source]
    );
    await client.query(
      `INSERT INTO court_records
         (id, person_id, case_number, court_name, state, case_type, filing_date, disposition, source_url, source)
       SELECT gen_random_uuid(), person_id, record_number, record_title, state, record_type,
              start_date, left('Status: ' || record_status ||
                CASE WHEN end_date IS NULL THEN '' ELSE ' | End date: ' || end_date::text END ||
                CASE WHEN record_description IS NULL THEN '' ELSE ' | ' || record_description END, 200),
              source_url, $2
       FROM bulk_person_staging WHERE run_id = $1`,
      [runId, source]
    );
    await client.query(
      `UPDATE bulk_import_runs SET status = 'complete', finished_at = now(), cursor = NULL WHERE id = $1`,
      [runId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function importBulkSource(source: BulkSource, maxPages?: number): Promise<BulkImportResult> {
  const metadata = await source.fetchMetadata();
  if (!metadata.rowsUpdatedAt) throw new Error(`${source.sourceName} metadata has no dataset version`);
  const client = await pool.connect();
  let runId: string | undefined;
  try {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [source.sourceName]);
    if (!lock.rows[0]?.locked) throw new Error(`${source.sourceName} import is already running`);

    const complete = await client.query(
      "SELECT 1 FROM bulk_import_runs WHERE source = $1 AND dataset_version = $2 AND status = 'complete'",
      [source.sourceName, metadata.rowsUpdatedAt]
    );
    if (complete.rowCount) {
      return { source: source.sourceName, status: "unchanged", sourceRows: 0, acceptedRows: 0, rejectedRows: 0, datasetVersion: metadata.rowsUpdatedAt };
    }

    const run = await client.query<{ id: string }>(
      `INSERT INTO bulk_import_runs (id, source, dataset_version, status, metadata_json)
       VALUES (gen_random_uuid(), $1, $2, 'running', $3::jsonb)
       ON CONFLICT (source, dataset_version) DO UPDATE SET status = 'running', error = NULL,
         cursor = NULL, source_rows = 0, accepted_rows = 0, rejected_rows = 0, started_at = now(), finished_at = NULL
       RETURNING id`,
      [source.sourceName, metadata.rowsUpdatedAt, JSON.stringify(metadata)]
    );
    runId = run.rows[0].id;
    await client.query("DELETE FROM bulk_person_staging WHERE run_id = $1", [runId]);

    let cursor: string | undefined;
    let sourceRows = 0;
    let acceptedRows = 0;
    let rejectedRows = 0;
    let pageCount = 0;
    while (true) {
      const page = await source.fetchPage(cursor);
      await stageRows(client, runId, page.rows, metadata.officialDataUrl);
      sourceRows += page.sourceRowCount;
      acceptedRows += page.rows.length;
      rejectedRows += Object.values(page.rejections).reduce((sum, count) => sum + count, 0);
      cursor = page.nextCursor;
      pageCount += 1;
      await client.query(
        `UPDATE bulk_import_runs SET cursor = $2, source_rows = $3, accepted_rows = $4, rejected_rows = $5 WHERE id = $1`,
        [runId, cursor ?? null, sourceRows, acceptedRows, rejectedRows]
      );
      if (page.done || (maxPages !== undefined && pageCount >= maxPages)) break;
      if (!cursor) throw new Error(`${source.sourceName} returned an incomplete page without a cursor`);
    }
    if (maxPages !== undefined && cursor) {
      throw new Error(`${source.sourceName} validation stopped after ${maxPages} page(s); snapshot was not published`);
    }

    await publishRun(client, runId, source.sourceName);
    return { source: source.sourceName, status: "complete", sourceRows, acceptedRows, rejectedRows, datasetVersion: metadata.rowsUpdatedAt };
  } catch (error) {
    if (runId) {
      await client.query(
        "UPDATE bulk_import_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1",
        [runId, error instanceof Error ? error.message.slice(0, 4_000) : "Unknown bulk import failure"]
      );
    }
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [source.sourceName]).catch(() => undefined);
    client.release();
  }
}

export async function closeBulkDatabase(): Promise<void> {
  await pool.end();
}