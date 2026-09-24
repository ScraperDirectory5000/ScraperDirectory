"use client";

import { useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function OptOutPage() {
  const [fullName, setFullName] = useState("");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch(`${API_BASE_URL}/optout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName, email_or_details: details }),
    });
    setSubmitted(true);
  }

  if (submitted) {
    return <p className="text-slate-700">Your removal request has been submitted for review.</p>;
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold">Remove my information</h1>
      <p className="mt-2 text-sm text-slate-600">
        Submit your full name and identifying details (email, city/state, or profile link) so we can
        locate and remove your record.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <input
          required
          placeholder="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea
          required
          placeholder="Email, city/state, or a link to the profile you want removed"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          className="min-h-[100px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          Submit request
        </button>
      </form>
    </div>
  );
}
