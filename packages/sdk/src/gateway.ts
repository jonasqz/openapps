import { createHmac, timingSafeEqual } from 'node:crypto';
import { SdkConfigurationError, UntrustedRequestError } from './errors.js';
import { readHeader, readListHeader, readRawHeader, type HeaderBag } from './headers.js';

/**
 * Nutzer aus den Gateway-Headern (AGENTS.md Regel 1, Spec
 * `docs/specs/woche-1-forward-auth.md` Abschnitt 3, ADR 0004).
 *
 * Eine App baut keinen eigenen Login; sie liest den Nutzer hier und nirgends
 * sonst. Das Signal ist ein HMAC über die Identitätsangaben — nicht ein
 * geteiltes Geheimnis: Ein geteiltes Geheimnis belegt nur, dass *irgendein*
 * Aufruf vom Gateway kam, nicht, dass *diese* Nutzerangaben vom Gateway
 * stammen.
 */

/** Die fünf Identitäts-Header. Das Gateway setzt sie immer, auch mit leeren Werten. */
export const USER_ID_HEADER = 'x-auth-user-id';
export const USER_EMAIL_HEADER = 'x-auth-user-email';
export const GROUPS_HEADER = 'x-auth-groups';
export const ISSUED_AT_HEADER = 'x-auth-issued-at';
export const SIGNATURE_HEADER = 'x-auth-signature';

/** Env-Variablen, die die Control Plane pro App setzt. */
export const AUTH_SECRET_ENV = 'OPENAPPS_AUTH_SECRET';
export const APP_ID_ENV = 'OPENAPPS_APP_ID';
export const APP_HOST_ENV = 'OPENAPPS_APP_HOST';

/** Kürzere Secrets sind nicht ratefest genug für einen HMAC-Schlüssel. */
export const MIN_SECRET_LENGTH = 32;

/** Standard-Gültigkeitsfenster in Sekunden (Spec 3.2). */
export const DEFAULT_MAX_AGE_SECONDS = 60;

/**
 * Version des Signatur-Materials. Sie steht im Material selbst, damit ein
 * späteres Format nicht versehentlich gegen das alte prüft.
 */
export const SIGNATURE_MATERIAL_VERSION = 'openapps-forward-auth/1';

export interface PlatformUser {
  readonly id: string;
  readonly email: string;
  /** Gruppen aus dem Rechtemodell der Control Plane. Leer ist erlaubt. */
  readonly groups: readonly string[];
  /** Zeitpunkt der Entscheidung des Gateways. */
  readonly issuedAt: Date;
}

export interface GetUserOptions {
  /** HMAC-Schlüssel. Default: `process.env.OPENAPPS_AUTH_SECRET`. */
  readonly secret?: string | undefined;
  /** App-Id im Signatur-Material. Default: `process.env.OPENAPPS_APP_ID`. */
  readonly appId?: string | undefined;
  /** Eigene App-Domain im Signatur-Material. Default: `process.env.OPENAPPS_APP_HOST`. */
  readonly appHost?: string | undefined;
  /** Höchstalter von `X-Auth-Issued-At` in Sekunden. Default 60. */
  readonly maxAgeSeconds?: number | undefined;
  /**
   * Erlaubter Vorlauf in Sekunden, falls die Uhr des Gateways vorgeht.
   * Default 0 — „nicht in der Zukunft“ laut Spec 3.2.
   */
  readonly futureToleranceSeconds?: number | undefined;
  /** Uhr-Quelle in Millisekunden seit Epoche. Default `Date.now`. Injizierbar für Tests. */
  readonly now?: (() => number) | undefined;
}

/**
 * Liest den Nutzer aus den Headern, die das Gateway gesetzt hat, und prüft die
 * Signatur darüber.
 *
 * ## Warum eine Signatur nötig ist
 *
 * `X-Auth-User-Id` und die anderen Identitäts-Header sind gewöhnliche
 * HTTP-Header. Wer die App direkt erreicht — ein anderer Container im selben
 * Netz, ein fehlendes Traefik-Label nach einem Coolify-Update, ein
 * durchgereichter Port — kann sie frei setzen und wäre damit jeder Nutzer.
 * Genau das ist die größte Annahme im Brief (Auth über manuelle Traefik-Labels
 * bleibt bei Coolify-Updates stabil). Das SDK verlässt sich deshalb nicht
 * darauf, dass der Weg stimmt, sondern verlangt einen Beweis pro Aufruf — und
 * zwar einen über die Nutzerangaben selbst.
 *
 * ## Was das an die Infrastruktur voraussetzt
 *
 * 1. Das Gateway setzt alle fünf Identitäts-Header auf jedem Aufruf, den es an
 *    eine App weiterleitet — immer, auch mit leeren Werten (Spec 3.1).
 * 2. Das Gateway **entfernt** alle `X-Auth-*` Header der eingehenden Anfrage,
 *    bevor es die eigenen setzt. Das gilt für alle fünf, nicht nur für die
 *    Signatur: Vergisst ein Traefik-Label das, reicht Traefik einen vom Client
 *    mitgeschickten Header unverändert durch, und das Modell ist wertlos
 *    (ADR 0004, Folgen).
 * 3. Gateway und App kennen dasselbe Secret: Die Control Plane erzeugt es pro
 *    App und gibt es nur als Env-Variable `OPENAPPS_AUTH_SECRET` in diese App
 *    und ins Gateway. Mindestens 32 Zeichen, sonst bedient die App keinen
 *    Aufruf. Rotation heißt Redeploy — es gibt absichtlich keinen Übergangspfad
 *    mit zwei Secrets.
 * 4. Gateway und App haben eine ungefähr gleiche Uhr. Driftet sie um mehr als
 *    das Fenster, kommt niemand mehr durch — ein Ausfall, kein Loch, aber er
 *    muss überwacht werden.
 *
 * ## Was der HMAC nicht leistet
 *
 * Er belegt Herkunft und Unverändertheit der Angaben, **nicht** dass niemand
 * mitliest. Die Header und die Signatur gehen im Klartext über die Strecke
 * Gateway → App; wer dort mitlesen kann, kennt die Identität des Nutzers und
 * kann die Signatur innerhalb des Fensters für dieselbe Domain erneut
 * verwenden. Dagegen schützt nur die Netztrennung aus Spec 3.3 (kein
 * veröffentlichter Host-Port, nur das Gateway-Netz) oder TLS auf der Strecke.
 * Ebenso schützt er nicht gegen ein geleaktes Secret — wer es kennt, kann
 * beliebige Nutzerangaben signieren.
 *
 * @throws {UntrustedRequestError} wenn Signatur, Zeitfenster oder
 *   Identitäts-Header nicht stimmen. Nie ein anonymer Nutzer, nie ein Fallback.
 * @throws {SdkConfigurationError} wenn Secret, App-Id oder App-Domain fehlen
 *   oder unbrauchbar sind.
 */
export function getUser(headers: HeaderBag, options: GetUserOptions = {}): PlatformUser {
  const config = resolveConfig(options);

  // Rohwerte, genau wie sie ankommen: Das Signatur-Material wird Byte für Byte
  // über die unveränderten Header gebildet. Jede Normalisierung (trimmen,
  // Kleinschreibung, Sortieren) müsste das Gateway identisch vornehmen und ist
  // deshalb eine Fehlerquelle, die hier nicht entsteht. Ein fehlender Header
  // zählt als leerer Wert — das Gateway setzt alle fünf immer, also ist das
  // Fehlen selbst schon ein Angriff oder eine Fehlkonfiguration, und die
  // Signatur stimmt dann nicht.
  const rawUserId = readRawHeader(headers, USER_ID_HEADER) ?? '';
  const rawEmail = readRawHeader(headers, USER_EMAIL_HEADER) ?? '';
  const rawGroups = readRawHeader(headers, GROUPS_HEADER) ?? '';
  const rawIssuedAt = readRawHeader(headers, ISSUED_AT_HEADER) ?? '';

  const presentedSignature = readHeader(headers, SIGNATURE_HEADER);
  if (presentedSignature === undefined) {
    throw new UntrustedRequestError(
      `Header ${SIGNATURE_HEADER} fehlt oder ist mehrfach gesetzt. Der Aufruf kam nicht ` +
        'nachweisbar durch das Gateway.',
    );
  }

  // Der Host im Material ist immer die eigene, konfigurierte App-Domain. Eine
  // Signatur, die für eine andere Domain gebildet wurde, passt damit nicht —
  // Spec 3.2 Punkt 3 ist dadurch erfüllt, ohne dem Aufrufer zu glauben. Trägt
  // die Anfrage zusätzlich einen Host, der nicht die eigene Domain ist, ist sie
  // falsch geroutet; das wird vorher und mit klarer Meldung abgewiesen.
  assertRequestHost(headers, config.appHost);

  const expected = signatureFor({
    secret: config.secret,
    appId: config.appId,
    host: config.appHost,
    userId: rawUserId,
    email: rawEmail,
    groups: rawGroups,
    issuedAt: rawIssuedAt,
  });

  if (!signatureEquals(presentedSignature, expected)) {
    throw new UntrustedRequestError(
      `Header ${SIGNATURE_HEADER} passt nicht zu den Identitäts-Headern, zur App-Id oder zur ` +
        'App-Domain. Der Aufruf wird nicht bedient.',
    );
  }

  // Erst ab hier sind die Werte vertrauenswürdig.
  const issuedAt = parseIssuedAt(rawIssuedAt);
  assertWithinWindow(issuedAt, config);

  const id = readHeader(headers, USER_ID_HEADER);
  if (id === undefined) {
    throw new UntrustedRequestError(
      `Header ${USER_ID_HEADER} ist leer, obwohl die Signatur stimmt. Das Gateway hat keinen ` +
        'Nutzer weitergegeben.',
    );
  }

  const email = readHeader(headers, USER_EMAIL_HEADER);
  if (email === undefined) {
    throw new UntrustedRequestError(`Header ${USER_EMAIL_HEADER} ist leer.`);
  }

  return {
    id,
    email,
    groups: Object.freeze(readListHeader(headers, GROUPS_HEADER) ?? []),
    issuedAt: new Date(issuedAt * 1000),
  };
}

export interface SignatureInput {
  readonly secret: string;
  readonly appId: string;
  readonly host: string;
  /** Rohwert von `X-Auth-User-Id`. */
  readonly userId: string;
  /** Rohwert von `X-Auth-User-Email`. */
  readonly email: string;
  /** Rohwert von `X-Auth-Groups`, unverändert (kommagetrennt, nicht sortiert). */
  readonly groups: string;
  /** Rohwert von `X-Auth-Issued-At` als Zeichenkette, nicht als Zahl. */
  readonly issuedAt: string;
}

/**
 * Bildet die Signatur: HMAC-SHA256 über das Material aus `signatureMaterial`.
 * Schlüssel sind die UTF-8-Bytes des Secrets, das Material wird als UTF-8
 * gelesen, die Ausgabe ist Hex in Kleinbuchstaben (64 Zeichen). Beim Prüfen
 * wird Groß-/Kleinschreibung der Hex-Ziffern nicht beachtet.
 *
 * Exportiert, damit die Control Plane dieselbe Funktion benutzen kann statt sie
 * nachzubauen. Gateway und App müssen das Material Byte für Byte gleich bilden,
 * sonst ist die Prüfung eine Zufallsprüfung.
 */
export function signatureFor(input: SignatureInput): string {
  return createHmac('sha256', input.secret).update(signatureMaterial(input), 'utf8').digest('hex');
}

/**
 * Das Signatur-Material, eindeutig und ohne Mehrdeutigkeit an den Feldgrenzen.
 *
 * Format — sechs Felder in genau dieser Reihenfolge, jedes mit einem
 * Längenpräfix in UTF-8-Bytes:
 *
 *     openapps-forward-auth/1\n
 *     <bytes>:<app-id>\n
 *     <bytes>:<host>\n
 *     <bytes>:<x-auth-user-id>\n
 *     <bytes>:<x-auth-user-email>\n
 *     <bytes>:<x-auth-groups>\n
 *     <bytes>:<x-auth-issued-at>\n
 *
 * Beispiel (Zeilenumbrüche sichtbar gemacht):
 *
 *     openapps-forward-auth/1
 *     12:projektliste
 *     26:projektliste.apps.blyck.de
 *     7:usr_123
 *     14:jonas@blyck.de
 *     11:team,admins
 *     10:1762680000
 *
 * Warum Längenpräfixe und nicht ein Trennzeichen: Jedes Trennzeichen, das in
 * einem Wert vorkommen *könnte*, erlaubt es, Feldgrenzen zu verschieben. Eine
 * E-Mail `a@b.de|team` mit leeren Gruppen und die E-Mail `a@b.de` mit den
 * Gruppen `team` ergäben bei naiver Verkettung dasselbe Material und damit
 * dieselbe Signatur — zwei verschiedene Identitäten mit einem Beweis. Mit
 * Längenpräfixen ist das Material für jede Eingabe eindeutig, ohne dass ein
 * Zeichen verboten oder maskiert werden muss.
 *
 * Die Werte gehen unverändert ein, so wie sie als Header-Werte ankommen bzw.
 * gesetzt werden. Keine Normalisierung.
 */
export function signatureMaterial(input: Omit<SignatureInput, 'secret'>): string {
  const fields = [input.appId, input.host, input.userId, input.email, input.groups, input.issuedAt];
  return (
    `${SIGNATURE_MATERIAL_VERSION}\n` +
    fields.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}\n`).join('')
  );
}

interface ResolvedConfig {
  readonly secret: string;
  readonly appId: string;
  readonly appHost: string;
  readonly maxAgeSeconds: number;
  readonly futureToleranceSeconds: number;
  readonly now: () => number;
}

function resolveConfig(options: GetUserOptions): ResolvedConfig {
  const secret = (options.secret ?? process.env[AUTH_SECRET_ENV] ?? '').trim();
  if (secret === '') {
    throw new SdkConfigurationError(
      `${AUTH_SECRET_ENV} ist nicht gesetzt. Ohne das Secret kann die App die Identitäts-Header ` +
        'nicht prüfen und bedient deshalb keinen Aufruf.',
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new SdkConfigurationError(
      `${AUTH_SECRET_ENV} ist kürzer als ${MIN_SECRET_LENGTH} Zeichen und damit zu schwach.`,
    );
  }

  const appId = (options.appId ?? process.env[APP_ID_ENV] ?? '').trim();
  if (appId === '') {
    throw new SdkConfigurationError(
      `${APP_ID_ENV} ist nicht gesetzt. Die App-Id geht in die Signatur ein, damit eine ` +
        'Signatur für eine andere App hier nicht gilt.',
    );
  }

  const appHost = (options.appHost ?? process.env[APP_HOST_ENV] ?? '').trim().toLowerCase();
  if (appHost === '') {
    throw new SdkConfigurationError(
      `${APP_HOST_ENV} ist nicht gesetzt. Ohne die eigene Domain kann die App nicht prüfen, ob ` +
        'eine Signatur für sie gilt (Spec 3.2 Punkt 3).',
    );
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new SdkConfigurationError('maxAgeSeconds muss eine positive Zahl sein.');
  }

  // Default 2 s Vorlauf, nicht 0: geht die Uhr des Gateways eine Sekunde vor,
  // wuerde bei 0 jeder Aufruf abgewiesen — ein Totalausfall als Antwort auf
  // Uhrendrift. 2 s decken NTP-Rauschen ab und verlaengern das Fenster einer
  // abgefangenen Signatur kaum (ADR 0004).
  const futureToleranceSeconds = options.futureToleranceSeconds ?? 2;
  if (!Number.isFinite(futureToleranceSeconds) || futureToleranceSeconds < 0) {
    throw new SdkConfigurationError('futureToleranceSeconds darf nicht negativ sein.');
  }

  return {
    secret,
    appId,
    appHost,
    maxAgeSeconds,
    futureToleranceSeconds,
    now: options.now ?? Date.now,
  };
}

/**
 * Weist einen Aufruf ab, der sichtbar für eine andere Domain gedacht war. Der
 * Host aus der Anfrage ist nicht die Quelle der Wahrheit — die
 * konfigurierte Domain ist es, sie allein geht in die Signatur ein. Diese
 * Prüfung gibt nur eine klare Meldung, bevor die Signatur scheitert, und fängt
 * eine falsch geroutete Anfrage. Fehlt der Host, wird nichts angenommen.
 */
function assertRequestHost(headers: HeaderBag, appHost: string): void {
  const presented = readHeader(headers, 'x-forwarded-host') ?? readHeader(headers, 'host');
  if (presented === undefined) {
    return;
  }
  if (hostOnly(presented) !== hostOnly(appHost)) {
    throw new UntrustedRequestError(
      `Der Aufruf richtet sich an '${presented}', diese App ist '${appHost}'. Eine Signatur für ` +
        'eine andere Domain gilt hier nicht.',
    );
  }
}

/** Host ohne Port, kleingeschrieben. IPv6 in Klammern bleibt unangetastet. */
function hostOnly(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower.startsWith('[')) {
    const end = lower.indexOf(']');
    return end === -1 ? lower : lower.slice(0, end + 1);
  }
  const colon = lower.indexOf(':');
  return colon === -1 ? lower : lower.slice(0, colon);
}

/** Unix-Zeit in Sekunden, streng: nur Ziffern, keine Vorzeichen, kein Komma. */
function parseIssuedAt(raw: string): number {
  if (!/^\d{1,15}$/.test(raw)) {
    throw new UntrustedRequestError(
      `Header ${ISSUED_AT_HEADER} ist keine Unix-Zeit in Sekunden: '${raw}'.`,
    );
  }
  return Number.parseInt(raw, 10);
}

function assertWithinWindow(issuedAtSeconds: number, config: ResolvedConfig): void {
  const nowSeconds = config.now() / 1000;
  const ageSeconds = nowSeconds - issuedAtSeconds;

  if (ageSeconds > config.maxAgeSeconds) {
    throw new UntrustedRequestError(
      `Header ${ISSUED_AT_HEADER} ist ${Math.floor(ageSeconds)} s alt, erlaubt sind ` +
        `${config.maxAgeSeconds} s. Der Aufruf wird nicht bedient.`,
    );
  }
  if (ageSeconds < -config.futureToleranceSeconds) {
    throw new UntrustedRequestError(
      `Header ${ISSUED_AT_HEADER} liegt in der Zukunft. Entweder driftet eine Uhr oder der Wert ` +
        'ist gefälscht.',
    );
  }
}

/**
 * Zeitkonstanter Vergleich zweier Hex-Signaturen. Verglichen werden die
 * HMAC-SHA256-Digests der Zeichenketten, nicht die Zeichenketten selbst: Die
 * Digests sind immer gleich lang, damit verrät auch die Länge des
 * mitgeschickten Werts nichts, und ein unbrauchbares Hex braucht keinen
 * eigenen, früher antwortenden Pfad.
 */
function signatureEquals(presented: string, expected: string): boolean {
  const key = 'openapps-signature-compare';
  const a = createHmac('sha256', key).update(presented.toLowerCase(), 'utf8').digest();
  const b = createHmac('sha256', key).update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
