/**
 * Wer darf sich ueberhaupt anmelden — und wer landet beim ersten Login in
 * welcher Gruppe. Reine Funktionen, ohne Better Auth und ohne Datenbank, damit
 * die zwei riskanten Regeln ohne Infrastruktur pruefbar sind:
 *
 * 1. **Die Domain-Schranke.** Eine Anmeldung mit einer E-Mail ausserhalb von
 *    `AUTH_ALLOWED_EMAIL_DOMAINS` wird **abgewiesen**, nicht nur ohne Freigabe
 *    gelassen. Ist die Liste leer, wird **jede** Anmeldung abgewiesen. Ohne
 *    diese Regel kann sich jeder mit einem Google-Konto ein Konto auf der
 *    Plattform anlegen — Google prueft nur, dass die Adresse ihm gehoert, nicht
 *    dass sie zu uns gehoert.
 * 2. **Der Bootstrap.** `AUTH_BOOTSTRAP_ADMINS` nennt die Adressen, die beim
 *    Login Mitglied von `platform-admins` werden — der Gruppe, die Migration
 *    0006 den Wildcard-Grant gegeben hat. Ohne diese Variable kommt niemand an
 *    die Control Plane, und das ist richtig.
 */

/** Die Gruppe mit dem Wildcard-Grant aus Migration 0006. */
export const BOOTSTRAP_GROUP = 'platform-admins';

/** Wer den Bootstrap-Eintrag vergeben hat — dieselbe Form wie in 0006. */
export const BOOTSTRAP_GRANTED_BY = 'system:bootstrap';

/** Eine Anmeldung, die nicht stattfinden darf. Kein Konto, keine Session. */
export class EmailDomainRejectedError extends Error {
  constructor(readonly email: string) {
    super(
      `Anmeldung abgelehnt: "${email}" liegt nicht in AUTH_ALLOWED_EMAIL_DOMAINS. ` +
        'Ist die Variable leer, ist keine Anmeldung zugelassen.',
    );
    this.name = 'EmailDomainRejectedError';
  }
}

/** Kommagetrennte Liste aus der Env, getrimmt und kleingeschrieben. */
function split(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

/**
 * Domains aus der Env. Ein fuehrendes `@` wird geschluckt, damit
 * `AUTH_ALLOWED_EMAIL_DOMAINS=@example.com` dasselbe bedeutet wie
 * `example.com` — der haeufigste Tippfehler, und er darf nicht still alles
 * ausschliessen oder alles oeffnen.
 */
export function parseDomainList(raw: string | undefined): readonly string[] {
  return split(raw).map((entry) => (entry.startsWith('@') ? entry.slice(1) : entry));
}

/** E-Mail-Liste aus der Env (Bootstrap-Adressen), kleingeschrieben. */
export function parseEmailList(raw: string | undefined): readonly string[] {
  return split(raw).filter((entry) => entry.includes('@'));
}

/** Domain-Teil einer E-Mail, kleingeschrieben. `null`, wenn es keine ist. */
export function emailDomain(email: string): string | null {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  const domain = value.slice(at + 1);
  return domain.includes('@') ? null : domain;
}

/** E-Mail in der Form, in der sie gespeichert und verglichen wird. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Darf diese Adresse sich anmelden? Exakter Domain-Vergleich, **kein**
 * Suffix-Vergleich: `example.com` erlaubt nicht `evil-example.com` und auch
 * nicht `sub.example.com`. Wer eine Subdomain braucht, nennt sie.
 */
export function emailDomainAllowed(email: string, allowedDomains: readonly string[]): boolean {
  if (allowedDomains.length === 0) return false;
  const domain = emailDomain(email);
  if (domain === null) return false;
  return allowedDomains.includes(domain);
}

export function assertEmailDomainAllowed(email: string, allowedDomains: readonly string[]): void {
  if (!emailDomainAllowed(email, allowedDomains)) {
    throw new EmailDomainRejectedError(normalizeEmail(email));
  }
}

/** Nur der Schreibpfad, den der Bootstrap braucht. */
export interface GroupMembershipWriter {
  ensureMembership(group: string, email: string, addedBy: string): Promise<void>;
}

/**
 * Traegt eine Bootstrap-Adresse in `platform-admins` ein. Laeuft bei jedem
 * Login, nicht nur beim ersten: eine spaeter ergaenzte Adresse soll beim
 * naechsten Login greifen, ohne Handgriff an der Datenbank. Der Aufruf ist
 * idempotent und gibt zurueck, ob diese Adresse dazugehoert.
 */
export async function applyBootstrapMembership(
  email: string,
  bootstrapAdmins: readonly string[],
  groups: GroupMembershipWriter,
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!bootstrapAdmins.includes(normalized)) return false;
  await groups.ensureMembership(BOOTSTRAP_GROUP, normalized, BOOTSTRAP_GRANTED_BY);
  return true;
}
