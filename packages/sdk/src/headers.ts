/**
 * Header-Zugriff über die Formen, in denen sie in Node und in Web-Runtimes
 * ankommen: die Fetch-`Headers`, `IncomingHttpHeaders` aus `node:http` und das
 * `ReadonlyHeaders` von Next.js (`headers()`), das `get` hat, aber kein
 * `Symbol.iterator` garantiert.
 */
export type HeaderBag =
  | { get(name: string): string | null | undefined }
  | Record<string, string | readonly string[] | undefined>;

/**
 * Liest einen Header, ohne Groß-/Kleinschreibung zu beachten. Mehrfach gesetzte
 * Header gelten als nicht eindeutig und liefern `undefined` — bei Auth-Headern
 * ist „der erste gewinnt“ eine Lücke, nicht eine Konvention. Leere Werte
 * liefern ebenfalls `undefined`.
 */
export function readHeader(headers: HeaderBag, name: string): string | undefined {
  const values = rawValues(headers, name);
  if (values.length !== 1) {
    return undefined;
  }
  return normalize(values[0]);
}

/**
 * Wie `readHeader`, erlaubt aber den Mehrfachwert: mehrere Header-Zeilen und
 * kommaseparierte Werte innerhalb einer Zeile. Für `X-Auth-Groups`.
 */
export function readListHeader(headers: HeaderBag, name: string): string[] | undefined {
  const values = rawValues(headers, name);
  if (values.length === 0) {
    return undefined;
  }
  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value !== '');
}

/**
 * Der Rohwert eines Headers: unverändert, nicht getrimmt, leere Werte bleiben
 * leer. Für das Signatur-Material — dort muss Byte für Byte eingehen, was
 * ankommt. `undefined` nur, wenn der Header fehlt oder mehrfach gesetzt ist.
 */
export function readRawHeader(headers: HeaderBag, name: string): string | undefined {
  const values = rawValues(headers, name);
  return values.length === 1 ? values[0] : undefined;
}

/** Alle Werte eines Headers als Zeichenketten, ohne Groß-/Kleinschreibung. */
function rawValues(headers: HeaderBag, name: string): string[] {
  const raw = rawHeader(headers, name);
  if (raw === undefined || raw === null) {
    return [];
  }
  if (typeof raw === 'string') {
    return [raw];
  }
  // readonly string[] — kopieren, nicht durchreichen.
  return Array.from(raw);
}

function rawHeader(
  headers: HeaderBag,
  name: string,
): string | readonly string[] | null | undefined {
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    return (headers as { get(key: string): string | null | undefined }).get(name);
  }
  const bag = headers as Record<string, string | readonly string[] | undefined>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(bag)) {
    if (key.toLowerCase() === lower) {
      return bag[key];
    }
  }
  return undefined;
}

function normalize(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
