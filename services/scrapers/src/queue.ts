import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import type { PersonQuery } from "./types.js";

export const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379/0", {
  maxRetriesPerRequest: null,
});

export const SCRAPE_QUEUE_NAME = "person-scrape";

export interface ScrapeJobData {
  query: PersonQuery;
  connectors: string[]; // sourceName values to run, e.g. ["npi_registry", "sec_edgar"]
}

export const scrapeQueue = new Queue<ScrapeJobData>(SCRAPE_QUEUE_NAME, { connection });
