const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 10_000);
  }
  if (response?.status === 429) return 5_500;
  return 500 * 2 ** attempt;
}

export async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response | undefined;
    try {
      const timeoutSignal = AbortSignal.timeout(30_000);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
      response = await fetch(url, { ...init, signal });
      if (response.ok || !RETRYABLE_STATUSES.has(response.status)) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Provider request failed");
}