import Link from "next/link";
import { searchPeople } from "@/lib/api";

interface ResultsPageProps {
  searchParams: Promise<{ first_name?: string; last_name?: string; state?: string; city?: string }>;
}

export default async function ResultsPage({ searchParams }: ResultsPageProps) {
  const { first_name = "", last_name = "", state, city } = await searchParams;

  if (!first_name || !last_name) {
    return <p className="text-slate-600">Enter a first and last name to search.</p>;
  }

  let data;
  let error: string | null = null;
  try {
    data = await searchPeople({ firstName: first_name, lastName: last_name, state, city });
  } catch {
    error = "Search is temporarily unavailable. Please try again shortly.";
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">
        Results for &ldquo;{first_name} {last_name}&rdquo;
      </h1>

      {error && <p className="mt-4 text-red-600">{error}</p>}

      {data?.status === "processing" && (
        <p className="mt-6 text-slate-600">Public sources are still being searched. Refresh shortly.</p>
      )}

      {data?.status === "partial" && (
        <p className="mt-6 text-amber-700">
          Some public sources were temporarily unavailable: {data.provider_failures.join(", ")}. Results below are partial.
        </p>
      )}

      {data && data.status === "complete" && data.total === 0 && (
        <p className="mt-6 text-slate-600">No public records found for that name and location.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {data?.results.map((person) => (
          <li key={person.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <Link href={`/person/${person.id}`} className="block">
              <p className="text-lg font-medium text-brand-700">
                {person.first_name} {person.middle_name ? `${person.middle_name} ` : ""}
                {person.last_name}
              </p>
              <p className="text-sm text-slate-500">
                {person.age_estimate ? `Age ${person.age_estimate} · ` : ""}
                {[person.cities.join(", "), person.states.join(", ")].filter(Boolean).join(", ") ||
                  "Location unknown"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
