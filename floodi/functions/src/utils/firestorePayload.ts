/** Missing source fields must remain absent, rather than blocking every
 * observation in a Firestore bucket. Preserve actual zeros, nulls and SDK
 * values such as timestamps or serverTimestamp sentinels. */
export function sanitizeFirestorePayload<T>(value: T): T {
  const clean = (input: unknown): unknown => {
    if (input === undefined || (typeof input === 'number' && !Number.isFinite(input))) return undefined;
    if (Array.isArray(input)) return input.map(item => clean(item) ?? null);
    if (input && typeof input === 'object' && (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null)) {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input)) {
        const valid = clean(item);
        if (valid !== undefined) result[key] = valid;
      }
      return result;
    }
    return input;
  };
  return clean(value) as T;
}
