"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { getSearchStatus, searchPeople, type SearchResponse } from "@/lib/api";

const PROVIDER_NAMES: Record<string, string> = {
  npi_registry: "Professional licenses",
  sec_edgar: "SEC filings",
  fec_contributions: "Campaign contributions",
  loc_newspapers: "Historical newspapers",
  gdelt_news: "Current news",
};

interface ResultsClientProps {
  firstName: string;
  lastName: string;
  state?: string;
  city?: string;
}

export default function ResultsClient({ firstName, lastName, state, city }: ResultsClientProps) {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const params = { firstName, lastName, state, city };

    const update = (next: SearchResponse) => {
      if (!cancelled) startTransition(() => setData(next));
    };

    const poll = async (jobId: string) => {
      try {
        const next = await getSearchStatus(jobId, params);
        if (!cancelled) setError(null);
        update(next);
        if (!cancelled && next.status === "processing") {
          timer = setTimeout(() => void poll(jobId), 1_000);
        }
      } catch {
        if (!cancelled) {
          setError("Live search status is temporarily unavailable. Retrying.");
          timer = setTimeout(() => void poll(jobId), 2_000);
        }
      }
    };

    const start = async () => {
      try {
        const initial = await searchPeople({ ...params, wait: false });
        update(initial);
        if (initial.status === "processing" && initial.job_id) {
          timer = setTimeout(() => void poll(initial.job_id as string), 500);
        }
      } catch {
        if (!cancelled) setError("Search is temporarily unavailable. Please try again shortly.");
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [city, firstName, lastName, state]);

  const providers = Object.entries(data?.provider_progress ?? {});
  const finished = providers.filter(([, progress]) => ["complete", "failed"].includes(progress.status)).length;
  const progressPercent = providers.length > 0 ? Math.round((finished / providers.length) * 100) : 0;
  const recordsFound = providers.reduce((total, [, progress]) => total + progress.records, 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold">
        Results for &ldquo;{firstName} {lastName}&rdquo;
      </h1>

      {error && <p className="mt-4 text-red-600">{error}</p>}

      {data?.status === "processing" && (
        <section className="mt-6 border-y border-slate-200 py-5" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden="true" />
            <div>
              <p className="font-medium text-slate-900">Searching public sources</p>
              <p className="text-sm text-slate-600">
                {providers.length > 0 ? `${finished} of ${providers.length} sources finished` : "Preparing source scans"}
                {recordsFound > 0 ? ` · ${recordsFound} records found` : ""}
              </p>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
            <div className="h-full bg-brand-600 transition-[width] duration-500" style={{ width: `${progressPercent}%` }} />
          </div>
          {providers.length > 0 && (
            <ul className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {providers.map(([name, progress]) => (
                <li key={name} className="flex items-center justify-between gap-4">
                  <span className="text-slate-700">{PROVIDER_NAMES[name] ?? name}</span>
                  <span className={progress.status === "failed" ? "text-red-600" : "text-slate-500"}>
                    {progress.status === "complete" ? `${progress.records} found` : progress.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data?.status === "partial" && (
        <p className="mt-6 text-amber-700">
          Some public sources were temporarily unavailable: {data.provider_failures.map((name) => PROVIDER_NAMES[name] ?? name).join(", ")}. Results below are partial.
        </p>
      )}

      {data?.location_filter_relaxed && (
        <p className="mt-4 text-amber-700">
          No exact location matches were found. Showing name matches from other or unconfirmed locations.
        </p>
      )}

      {data && data.status !== "processing" && data.total === 0 && (
        <p className="mt-6 text-slate-600">No public records found for that name and location.</p>
      )}

      <ul className="mt-6 flex flex-col gap-3" aria-live="polite">
        {data?.results.map((person) => (
          <li key={person.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <Link href={`/person/${person.id}`} className="block">
              <p className="text-lg font-medium text-brand-700">
                {person.first_name} {person.middle_name ? `${person.middle_name} ` : ""}
                {person.last_name}
              </p>
              <p className="text-sm text-slate-500">
                {person.age_estimate ? `Age ${person.age_estimate} · ` : ""}
                {[person.cities.join(", "), person.states.join(", ")].filter(Boolean).join(", ") || "Location unknown"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}