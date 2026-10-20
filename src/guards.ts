/** Whether a parsed JSON value is an object (not null or an array), to read fields from. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
