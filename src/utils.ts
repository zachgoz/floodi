export function formatYMD(date: Date): string {
  return date.toISOString().slice(0,10).replace(/-/g, '');
}
