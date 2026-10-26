import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const MIN_COMPRESS_BYTES = 1_024;

function encodingQualities(acceptEncoding: string | undefined): Map<string, number> {
  const encodings = new Map<string, number>();
  for (const entry of (acceptEncoding || '').split(',')) {
    const [name, ...parameters] = entry.trim().toLowerCase().split(';');
    if (!name) continue;
    const qualityParameter = parameters.find(parameter => parameter.trim().startsWith('q='));
    const qualityText = qualityParameter?.trim().slice(2).trim();
    const quality = qualityText === undefined ? 1 : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(qualityText) ? Number(qualityText) : 0;
    encodings.set(name, quality);
  }
  return encodings;
}

/** Respect explicit refusals, including when a wildcard also permits gzip. */
export function acceptsGzip(acceptEncoding: string | undefined): boolean {
  const encodings = encodingQualities(acceptEncoding);
  return (encodings.get('gzip') ?? encodings.get('*') ?? 0) > 0;
}

/** Keep the public JSON schema intact; full numerical archives are unaffected. */
export async function encodeJsonResponse(value: unknown, acceptEncoding: string | undefined): Promise<{ body: string | Buffer; contentEncoding?: 'gzip'; notAcceptable?: true }> {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('A JSON response value is required');
  const qualities = encodingQualities(acceptEncoding);
  const gzipAccepted = acceptsGzip(acceptEncoding);
  // Identity is acceptable by default, except for an explicit refusal (or *;q=0).
  const identityAccepted = (qualities.get('identity') ?? (qualities.get('*') === 0 ? 0 : 1)) > 0;
  if (!gzipAccepted && !identityAccepted) return { body: '', notAcceptable: true };
  if (!gzipAccepted || identityAccepted && Buffer.byteLength(json) < MIN_COMPRESS_BYTES) return { body: json };
  const compressed = await gzipAsync(json, { level: 6 });
  return !identityAccepted || compressed.byteLength < Buffer.byteLength(json) ? { body: compressed, contentEncoding: 'gzip' } : { body: json };
}
