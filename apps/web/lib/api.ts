const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export interface PersonSummary {
  id: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  age_estimate?: number | null;
  cities: string[];
  states: string[];
}

export interface SearchResponse {
  total: number;
  results: PersonSummary[];
  status: "complete" | "partial" | "processing";
  provider_failures: string[];
  provider_progress: Record<string, { status: "waiting" | "searching" | "complete" | "failed"; records: number }>;
  job_id?: string | null;
  location_filter_relaxed: boolean;
}

export async function searchPeople(params: {
  firstName: string;
  lastName: string;
  state?: string;
  city?: string;
  wait?: boolean;
}): Promise<SearchResponse> {
  const query = new URLSearchParams({
    first_name: params.firstName,
    last_name: params.lastName,
  });
  if (params.state) query.set("state", params.state);
  if (params.city) query.set("city", params.city);
  if (params.wait === false) query.set("wait", "false");

  const response = await fetch(`${API_BASE_URL}/search?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }
  return response.json();
}

export async function getSearchStatus(jobId: string, params: {
  firstName: string;
  lastName: string;
  state?: string;
  city?: string;
}): Promise<SearchResponse> {
  const query = new URLSearchParams({
    first_name: params.firstName,
    last_name: params.lastName,
  });
  if (params.state) query.set("state", params.state);
  if (params.city) query.set("city", params.city);

  const response = await fetch(`${API_BASE_URL}/search/status/${encodeURIComponent(jobId)}?${query.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Search status failed: ${response.status}`);
  return response.json();
}

export interface PersonDetail extends PersonSummary {
  dob_year?: number | null;
  addresses: Array<{ line1: string; city?: string; state?: string; zip_code?: string }>;
  phones: Array<{ number: string; phone_type?: string }>;
  emails: Array<{ email: string }>;
  usernames: Array<{ username: string; platform_guess?: string }>;
  social_profiles: Array<{ platform: string; url: string }>;
  court_records: Array<{ case_number?: string; court_name?: string; state?: string; case_type?: string }>;
  life_events: Array<{
    event_type: string;
    event_date?: string | null;
    state?: string | null;
    locality?: string | null;
    description?: string | null;
    source: string;
    source_record_id: string;
    source_url: string;
    confidence: number;
  }>;
  relationship_claims: Array<{
    relation_type: string;
    related_first_name: string;
    related_middle_name?: string | null;
    related_last_name: string;
    event_date?: string | null;
    source: string;
    source_record_id: string;
    source_url: string;
    confidence: number;
  }>;
}

export async function getPerson(id: string, accessToken: string): Promise<PersonDetail> {
  const response = await fetch(`${API_BASE_URL}/persons/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Person lookup failed: ${response.status}`);
  }
  return response.json();
}
