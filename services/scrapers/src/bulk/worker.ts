import { importBulkSource } from "./db.js";
import { createBulkSource } from "./sources.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const sourceNames = (process.env.BULK_SOURCES ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

if (sourceNames.length === 0) throw new Error("BULK_SOURCES must list at least one approved source");

async function refreshAll(): Promise<void> {
  for (const sourceName of sourceNames) {
    try {
      const result = await importBulkSource(createBulkSource(sourceName));
      console.log(`[bulk:${sourceName}] ${JSON.stringify(result)}`);
    } catch (error) {
      console.error(`[bulk:${sourceName}] refresh failed`, error);
    }
  }
}

await refreshAll();
setInterval(() => void refreshAll(), DAY_MS).unref();
await new Promise(() => undefined);