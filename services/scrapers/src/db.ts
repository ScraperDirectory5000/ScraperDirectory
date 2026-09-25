import pg from "pg";
import type { NormalizedPerson } from "./types.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/** Finds an existing person by exact first/last name match, or creates one.
 * This is a simple dedup strategy for the reference connectors — a real
 * entity-resolution pass (fuzzy match on name+dob+address) belongs here later. */
async function findOrCreatePerson(client: pg.PoolClient, person: NormalizedPerson): Promise<string> {
  if (person.externalId) {
    const sourced = await client.query<{ person_id: string }>(
      `SELECT person_id FROM person_source_identities WHERE source = $1 AND external_id = $2 LIMIT 1`,
      [person.source, person.externalId]
    );
    if (sourced.rows.length > 0) return sourced.rows[0].person_id;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO persons (id, first_name, middle_name, last_name, dob_year, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())
       RETURNING id`,
      [person.firstName, person.middleName ?? null, person.lastName, person.dobYear ?? null]
    );
    await client.query(
      `INSERT INTO person_source_identities (id, person_id, source, external_id)
       VALUES (gen_random_uuid(), $1, $2, $3)`,
      [inserted.rows[0].id, person.source, person.externalId]
    );
    return inserted.rows[0].id;
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM persons WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2) LIMIT 1`,
    [person.firstName, person.lastName]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO persons (id, first_name, middle_name, last_name, dob_year, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())
     RETURNING id`,
    [person.firstName, person.middleName ?? null, person.lastName, person.dobYear ?? null]
  );
  return inserted.rows[0].id;
}

export async function persistNormalizedPerson(person: NormalizedPerson): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const personId = await findOrCreatePerson(client, person);

    for (const address of person.addresses ?? []) {
      if (!address.line1) continue;
      await client.query(
        `INSERT INTO addresses (id, person_id, line1, line2, city, state, zip_code, source)
         SELECT gen_random_uuid(), $1, $2::varchar, $3, $4, $5, $6::varchar, $7
         WHERE NOT EXISTS (
           SELECT 1 FROM addresses
           WHERE person_id = $1
             AND line1 = $2::varchar
             AND coalesce(zip_code, '') = coalesce($6::varchar, '')
         )`,
        [personId, address.line1, address.line2 ?? null, address.city ?? null, address.state ?? null, address.zipCode ?? null, person.source]
      );
    }

    for (const phone of person.phones ?? []) {
      await client.query(
        `INSERT INTO phones (id, person_id, number, phone_type, source)
         SELECT gen_random_uuid(), $1, $2::varchar, $3, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM phones WHERE person_id = $1 AND number = $2::varchar
         )`,
        [personId, phone.number, phone.phoneType ?? null, person.source]
      );
    }

    for (const email of person.emails ?? []) {
      await client.query(
        `INSERT INTO emails (id, person_id, email, source)
         SELECT gen_random_uuid(), $1, $2::varchar, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM emails WHERE person_id = $1 AND email = $2::varchar
         )`,
        [personId, email.email, person.source]
      );
    }

    for (const record of person.records ?? []) {
      await client.query(
        `INSERT INTO court_records (id, person_id, case_number, court_name, state, case_type, filing_date, disposition, source_url)
         SELECT gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8
         WHERE NOT EXISTS (
           SELECT 1 FROM court_records
           WHERE person_id = $1
             AND coalesce(source_url, '') = coalesce($8::text, '')
             AND coalesce(case_number, '') = coalesce($2::varchar, '')
             AND coalesce(case_type, '') = coalesce($5::varchar, '')
         )`,
        [
          personId,
          record.caseNumber ?? null,
          record.courtName ?? null,
          record.state ?? null,
          record.caseType ?? null,
          record.filingDate ?? null,
          record.disposition ?? null,
          record.sourceUrl ?? null,
        ]
      );
    }

    await client.query("COMMIT");
    return personId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
