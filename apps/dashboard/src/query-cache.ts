// Memory only: full request URLs include project, source, filters and pagination.
// Session changes and successful writes invalidate all entries, including pending results.
const maximumEntries = 160,
  defaultTtl = 5000;
type Entry = {value: unknown; expires: number};
const entries = new Map<string, Entry>(),
  pending = new Map<string, Promise<unknown>>();
let generation = 0,
  sessionGeneration = 0;
export function invalidateQueries() {
  generation++;
  entries.clear();
  pending.clear();
}
export function resetQuerySession() {
  sessionGeneration++;
  invalidateQueries();
}
export async function cachedQuery<T>(key: string, loader: () => Promise<T>, ttl = defaultTtl): Promise<T> {
  const session = sessionGeneration;
  const cached = entries.get(key);
  if (cached && cached.expires > Date.now()) return structuredClone(cached.value) as T;
  const existing = pending.get(key);
  if (existing) {
    const value = await existing;
    if (session !== sessionGeneration) throw new Error('SESSION_CHANGED');
    return structuredClone(value) as T;
  }
  const version = generation;
  const request = loader().then((value) => {
    if (version === generation) {
      entries.delete(key);
      entries.set(key, {value: structuredClone(value), expires: Date.now() + ttl});
      while (entries.size > maximumEntries) entries.delete(entries.keys().next().value!);
    }
    return value;
  });
  pending.set(key, request);
  try {
    const value = await request;
    if (session !== sessionGeneration) throw new Error('SESSION_CHANGED');
    return structuredClone(value);
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
}
export async function readQuery<T>(url: string): Promise<T> {
  return cachedQuery(url, async () => {
    const response = await fetch(url, {credentials: 'same-origin', headers: {Accept: 'application/json'}});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.code ?? 'REQUEST_FAILED');
    return body as T;
  });
}
