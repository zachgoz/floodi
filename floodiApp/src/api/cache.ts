import localforage from 'localforage';

export async function cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = await localforage.getItem<T>(key);
  if (cached) return cached;
  const data = await fetcher();
  await localforage.setItem(key, data);
  return data;
}
