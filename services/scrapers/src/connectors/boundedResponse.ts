export async function readBoundedText(
  response: Response,
  maxBytes: number,
  sourceName: string
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel();
      throw new Error(`${sourceName} response exceeds ${maxBytes} byte limit`);
    }
  }

  if (!response.body) throw new Error(`${sourceName} response body is missing`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        throw new Error(`${sourceName} response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}