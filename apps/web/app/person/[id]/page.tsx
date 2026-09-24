"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { PersonDetail } from "@/lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "paywalled" | "unauthenticated" | "ready" | "error">("loading");

  useEffect(() => {
    void loadPerson();
  }, [id]);

  async function loadPerson() {
    const token = localStorage.getItem("pf_access_token");
    if (!token) {
      setStatus("unauthenticated");
      return;
    }
    const response = await fetch(`${API_BASE_URL}/persons/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (response.status === 402) {
      setStatus("paywalled");
      return;
    }
    if (!response.ok) {
      setStatus("error");
      return;
    }
    setPerson(await response.json());
    setStatus("ready");
  }

  async function buyReport() {
    const token = localStorage.getItem("pf_access_token");
    if (!token) {
      setStatus("unauthenticated");
      return;
    }
    const response = await fetch(`${API_BASE_URL}/payments/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { approve_url } = await response.json();
    if (approve_url) {
      window.location.href = approve_url;
    }
  }

  if (status === "loading") return <p className="text-slate-600">Loading…</p>;
  if (status === "unauthenticated")
    return (
      <p className="text-slate-600">
        <a href="/login" className="text-brand-700 underline">
          Log in
        </a>{" "}
        to view the full report.
      </p>
    );
  if (status === "error") return <p className="text-red-600">Something went wrong loading this record.</p>;

  if (status === "paywalled")
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-slate-700">This full report is locked.</p>
        <button
          onClick={buyReport}
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Unlock report — $4.95 (PayPal)
        </button>
      </div>
    );

  if (!person) return null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        {person.first_name} {person.middle_name ?? ""} {person.last_name}
      </h1>

      <Section title="Addresses">
        {person.addresses.map((a, i) => (
          <p key={i}>
            {a.line1}, {a.city}, {a.state} {a.zip_code}
          </p>
        ))}
      </Section>

      <Section title="Phone numbers">
        {person.phones.map((p, i) => (
          <p key={i}>
            {p.number} {p.phone_type ? `(${p.phone_type})` : ""}
          </p>
        ))}
      </Section>

      <Section title="Emails">
        {person.emails.map((e, i) => (
          <p key={i}>{e.email}</p>
        ))}
      </Section>

      <Section title="Court / filing records">
        {person.court_records.map((c, i) => (
          <p key={i}>
            {c.case_type} · {c.court_name} {c.state} {c.case_number}
          </p>
        ))}
      </Section>

      <Section title="Public social profiles">
        {person.social_profiles.map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noreferrer" className="text-brand-700 underline block">
            {s.platform}
          </a>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  );
}
