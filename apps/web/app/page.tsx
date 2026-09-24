export default function HomePage() {
  return (
    <div className="flex flex-col items-center gap-8 py-12 text-center">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          Find public records in seconds
        </h1>
        <p className="mt-3 text-slate-600">
          Search addresses, phone numbers, relatives, and public court records.
        </p>
      </div>

      <form action="/results" className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <input
            name="first_name"
            required
            placeholder="First name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <input
            name="last_name"
            required
            placeholder="Last name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <input
            name="city"
            placeholder="City (optional)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <input
            name="state"
            placeholder="State (e.g. CA)"
            maxLength={2}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:border-brand-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Search
        </button>
      </form>
    </div>
  );
}
