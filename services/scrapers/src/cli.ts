import { scrapeQueue } from "./queue.js";

/** Manual job enqueue helper for local testing:
 *   npm run enqueue -- "Jane" "Doe" CA */
async function main() {
  const [firstName, lastName, state] = process.argv.slice(2);
  if (!firstName || !lastName) {
    console.error('Usage: npm run enqueue -- "First" "Last" [STATE]');
    process.exit(1);
  }

  await scrapeQueue.add("scrape-person", {
    query: { firstName, lastName, state },
    connectors: ["npi_registry", "sec_edgar"],
  });

  console.log(`Enqueued scrape job for ${firstName} ${lastName}${state ? ` (${state})` : ""}`);
  process.exit(0);
}

main();
