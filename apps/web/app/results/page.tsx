import ResultsClient from "./results-client";

interface ResultsPageProps {
  searchParams: Promise<{ first_name?: string; last_name?: string; state?: string; city?: string }>;
}

export default async function ResultsPage({ searchParams }: ResultsPageProps) {
  const { first_name = "", last_name = "", state, city } = await searchParams;

  if (!first_name || !last_name) {
    return <p className="text-slate-600">Enter a first and last name to search.</p>;
  }

  return <ResultsClient firstName={first_name} lastName={last_name} state={state} city={city} />;
}
