import { Worker } from "bullmq";
import { connection, SCRAPE_QUEUE_NAME, type ScrapeJobData } from "./queue.js";
import { NpiRegistryConnector } from "./connectors/npiRegistry.js";
import { SecEdgarConnector } from "./connectors/secEdgar.js";
import { persistNormalizedPerson } from "./db.js";
import type { Connector } from "./types.js";

const CONNECTORS: Record<string, Connector> = {
  npi_registry: new NpiRegistryConnector(),
  sec_edgar: new SecEdgarConnector(),
};

const worker = new Worker<ScrapeJobData>(
  SCRAPE_QUEUE_NAME,
  async (job) => {
    const { query, connectors } = job.data;
    const targets = connectors.length > 0 ? connectors : Object.keys(CONNECTORS);

    for (const name of targets) {
      const connector = CONNECTORS[name];
      if (!connector) {
        console.warn(`Unknown connector "${name}", skipping`);
        continue;
      }
      try {
        const results = await connector.search(query);
        for (const person of results) {
          await persistNormalizedPerson(person);
        }
        console.log(`[${name}] persisted ${results.length} record(s) for ${query.firstName} ${query.lastName}`);
      } catch (error) {
        console.error(`[${name}] failed:`, error);
      }
    }
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

console.log("Scraper worker listening on queue:", SCRAPE_QUEUE_NAME);
