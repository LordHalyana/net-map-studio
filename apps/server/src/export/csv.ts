/** Minimal RFC-4180-ish CSV serialization for entity exports (design §3.12). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const first = rows[0];
  if (!first) return '';
  const headers = Object.keys(first);

  const cell = (value: unknown): string => {
    const text =
      value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => cell(row[h])).join(','));
  }
  return lines.join('\n');
}
