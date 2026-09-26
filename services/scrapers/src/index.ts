import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Worker } from "bullmq";
import { connection, scrapeQueue, SCRAPE_QUEUE_NAME, type ScrapeJobData } from "./queue.js";
import { NpiRegistryConnector } from "./connectors/npiRegistry.js";
import { SecEdgarConnector } from "./connectors/secEdgar.js";
import { LocNewspapersConnector } from "./connectors/locNewspapers.js";
import { GdeltNewsConnector } from "./connectors/gdeltNews.js";
import { IdahoCorrectionsConnector } from "./connectors/idahoCorrections.js";
import { CaliforniaCorrectionsConnector } from "./connectors/californiaCorrections.js";
import { MarylandCorrectionsConnector } from "./connectors/marylandCorrections.js";
import { AlabamaCorrectionsConnector } from "./connectors/alabamaCorrections.js";
import { DelawareDelprosLicensesConnector } from "./connectors/delawareDelprosLicenses.js";
import { GeorgiaCorrectionsConnector } from "./connectors/georgiaCorrections.js";
import { IllinoisCorrectionsConnector } from "./connectors/illinoisCorrections.js";
import { IowaCorrectionsConnector } from "./connectors/iowaCorrections.js";
import { MissouriFinanceEntitiesConnector } from "./connectors/missouriFinanceEntities.js";
import { NewYorkDosLicensesConnector } from "./connectors/newYorkDosLicenses.js";
import { NorthDakotaCorrectionsConnector } from "./connectors/northDakotaCorrections.js";
import { OhioCorrectionsConnector } from "./connectors/ohioCorrections.js";
import { OregonCorrectionsConnector } from "./connectors/oregonCorrections.js";
import { PennsylvaniaCorrectionsConnector } from "./connectors/pennsylvaniaCorrections.js";
import { SouthCarolinaCorrectionsConnector } from "./connectors/southCarolinaCorrections.js";
import { VermontCorrectionsConnector } from "./connectors/vermontCorrections.js";
import { VirginiaDporLicensesConnector } from "./connectors/virginiaDporLicenses.js";
import { WashingtonCorrectionsConnector } from "./connectors/washingtonCorrections.js";
import { WyomingCorrectionsConnector } from "./connectors/wyomingCorrections.js";
import { persistNormalizedPerson } from "./db.js";
import { searchJobId } from "./jobIdentity.js";
import type { Connector, PersonQuery } from "./types.js";

const CONNECTORS: Record<string, Connector> = {
  npi_registry: new NpiRegistryConnector(),
  sec_edgar: new SecEdgarConnector(),
  loc_newspapers: new LocNewspapersConnector(),
  idaho_corrections: new IdahoCorrectionsConnector(),
  california_corrections: new CaliforniaCorrectionsConnector(),
  maryland_corrections: new MarylandCorrectionsConnector(),
  alabama_corrections: new AlabamaCorrectionsConnector(),
  delaware_delpros_licenses: new DelawareDelprosLicensesConnector(),
  georgia_corrections: new GeorgiaCorrectionsConnector(),
  illinois_corrections: new IllinoisCorrectionsConnector(),
  iowa_corrections: new IowaCorrectionsConnector(),
  missouri_finance_entities: new MissouriFinanceEntitiesConnector(),
  new_york_dos_licenses: new NewYorkDosLicensesConnector(),
  north_dakota_corrections: new NorthDakotaCorrectionsConnector(),
  ohio_corrections: new OhioCorrectionsConnector(),
  oregon_corrections: new OregonCorrectionsConnector(),
  pennsylvania_corrections: new PennsylvaniaCorrectionsConnector(),
  south_carolina_corrections: new SouthCarolinaCorrectionsConnector(),
  vermont_corrections: new VermontCorrectionsConnector(),
  virginia_dpor_licenses: new VirginiaDporLicensesConnector(),
  washington_corrections: new WashingtonCorrectionsConnector(),
  wyoming_corrections: new WyomingCorrectionsConnector(),
};
if (process.env.ENABLE_GDELT_NEWS === "true") CONNECTORS.gdelt_news = new GdeltNewsConnector();

const STATE_CONNECTORS: Record<string, string> = {
  AL: "alabama_corrections",
  CA: "california_corrections",
  DE: "delaware_delpros_licenses",
  GA: "georgia_corrections",
  ID: "idaho_corrections",
  IA: "iowa_corrections",
  IL: "illinois_corrections",
  MD: "maryland_corrections",
  MO: "missouri_finance_entities",
  ND: "north_dakota_corrections",
  NY: "new_york_dos_licenses",
  OH: "ohio_corrections",
  OR: "oregon_corrections",
  PA: "pennsylvania_corrections",
  SC: "south_carolina_corrections",
  VA: "virginia_dpor_licenses",
  VT: "vermont_corrections",
  WA: "washington_corrections",
  WY: "wyoming_corrections",
};

function connectorsForQuery(query: PersonQuery): string[] {
  const stateConnectorNames = new Set(Object.values(STATE_CONNECTORS));
  return Object.keys(CONNECTORS).filter((name) =>
    !stateConnectorNames.has(name) || STATE_CONNECTORS[query.state ?? ""] === name
  );
}

const worker = new Worker<ScrapeJobData>(
  SCRAPE_QUEUE_NAME,
  async (job) => {
    const { query, connectors } = job.data;
    const targets = connectors.length > 0 ? connectors : Object.keys(CONNECTORS);
    const providers: Record<string, { status: string; records: number }> = Object.fromEntries(
      targets.map((name) => [name, { status: "waiting", records: 0 }])
    );
    let progressWrite = Promise.resolve();
    const publishProgress = () => {
      const snapshot = { providers: structuredClone(providers) };
      progressWrite = progressWrite.then(() => job.updateProgress(snapshot));
      return progressWrite;
    };
    await publishProgress();

    const outcomes = await Promise.allSettled(targets.map(async (name) => {
      const connector = CONNECTORS[name];
      if (!connector) {
        throw new Error(`Unknown connector "${name}"`);
      }
      providers[name].status = "searching";
      await publishProgress();
      try {
        const results = await connector.search(query);
        for (const person of results) {
          await persistNormalizedPerson(person);
        }
        providers[name] = {
          status: "complete",
          records: results.reduce((count, person) => count + (person.records?.length ?? 0), 0),
        };
        await publishProgress();
        console.log(`[${name}] persisted ${results.length} record(s) for ${query.firstName} ${query.lastName}`);
      } catch (error) {
        providers[name].status = "failed";
        await publishProgress();
        throw error;
      }
    }));

    outcomes.forEach((outcome, index) => {
      if (outcome.status === "rejected") console.error(`[${targets[index]}] failed:`, outcome.reason);
    });

    if (outcomes.every((outcome) => outcome.status === "rejected")) {
      throw new Error("All requested public-record connectors failed");
    }
    return {
      failures: outcomes.flatMap((outcome, index) => outcome.status === "rejected" ? [targets[index]] : []),
    };
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

      const connectorNames = connectorsForQuery(query);
      const jobId = searchJobId(query, connectorNames);
      await scrapeQueue.add(
        "scrape-person",
        { query, connectors: connectorNames },
        { jobId, removeOnComplete: { age: 300 }, removeOnFail: { age: 60 } }
      );
      return sendJson(response, 202, { jobId });
    }

    if (request.method === "GET" && request.url?.startsWith("/jobs/")) {
      const jobId = decodeURIComponent(request.url.slice("/jobs/".length));
      const job = await scrapeQueue.getJob(jobId);
      if (!job) return sendJson(response, 404, { detail: "Job not found" });
      return sendJson(response, 200, {
        jobId,
        state: await job.getState(),
        failedReason: job.failedReason || null,
        failures: job.returnvalue?.failures ?? [],
        progress: typeof job.progress === "object" ? job.progress : { providers: {} },
      });
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
