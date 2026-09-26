import { closeBulkDatabase, importBulkSource } from "./db.js";
import { createBulkSource } from "./sources.js";

const sourceName = process.argv[2];
if (!sourceName) throw new Error("Usage: npm run bulk:ingest -- <source-name>");

try {
  const result = await importBulkSource(createBulkSource(sourceName));
  console.log(JSON.stringify(result));
} finally {
  await closeBulkDatabase();
}