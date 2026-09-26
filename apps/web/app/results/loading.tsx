export default function ResultsLoading() {
  return (
    <div className="flex items-center gap-3 py-6" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden="true" />
      <p className="text-slate-600">Starting public-source search</p>
    </div>
  );
}