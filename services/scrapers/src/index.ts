import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Worker } from "bullmq";
import { connection, scrapeQueue, SCRAPE_QUEUE_NAME, type ScrapeJobData } from "./queue.js";
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
    let successfulConnectors = 0;

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
        successfulConnectors += 1;
        console.log(`[${name}] persisted ${results.length} record(s) for ${query.firstName} ${query.lastName}`);
      } catch (error) {
        console.error(`[${name}] failed:`, error);
      }
    }

    if (successfulConnectors === 0) {
      throw new Error("All requested public-record connectors failed");
    }
  },
  { connection }
);

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

console.log("Scraper worker listening on queue:", SCRAPE_QUEUE_NAME);

function sendJson(response: ServerResponse, statusCode: number, body: object): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/jobs") {
      const body = (await readJson(request)) as { firstName?: unknown; lastName?: unknown; state?: unknown };
      if (typeof body.firstName !== "string" || typeof body.lastName !== "string") {
        return sendJson(response, 400, { detail: "firstName and lastName are required" });
      }

      const query = {
        firstName: body.firstName.trim().slice(0, 100),
        lastName: body.lastName.trim().slice(0, 100),
        state: typeof body.state === "string" ? body.state.trim().toUpperCase().slice(0, 2) : undefined,
      };
      if (!query.firstName || !query.lastName) {
        return sendJson(response, 400, { detail: "firstName and lastName are required" });
      }

      const key = `${query.firstName.toLowerCase()}|${query.lastName.toLowerCase()}|${query.state ?? ""}`;
      const jobId = `search-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
      await scrapeQueue.add(
        "scrape-person",
        { query, connectors: ["npi_registry", "sec_edgar"] },
        { jobId, removeOnComplete: { age: 300 }, removeOnFail: { age: 60 } }
      );
      return sendJson(response, 202, { jobId });
    }

    if (request.method === "GET" && request.url?.startsWith("/jobs/")) {
      const jobId = decodeURIComponent(request.url.slice("/jobs/".length));
      const job = await scrapeQueue.getJob(jobId);
      if (!job) return sendJson(response, 404, { detail: "Job not found" });
      return sendJson(response, 200, { jobId, state: await job.getState(), failedReason: job.failedReason || null });
    }

    return sendJson(response, 404, { detail: "Not found" });
  } catch (error) {
    console.error("Scraper control request failed:", error);
    return sendJson(response, 500, { detail: "Scraper control request failed" });
  }
});

const controlPort = Number(process.env.SCRAPER_CONTROL_PORT ?? 3001);
server.listen(controlPort, "0.0.0.0", () => {
  console.log(`Scraper control API listening on port ${controlPort}`);
});
