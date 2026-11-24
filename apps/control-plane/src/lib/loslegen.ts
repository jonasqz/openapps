/**
 * Das Onboarding: wie jemand mit dem eigenen Assistenten Apps baut und
 * ändert. Eine Quelle für zwei Wege. Die Verwaltung zeigt es als Seite
 * (`/loslegen`), der Plattform-MCP gibt es als Prompt `loslegen` aus. So weiß
 * ein Assistent ohne Browser dasselbe wie ein Mensch (CLAUDE.md, Agents first).
 *
 * Hier steht nie ein Token: Es erscheint genau einmal beim Anlegen eines
 * Agents und gehört in die Umgebung des Assistenten.
 */

/**
 * Gelesen werden `OPENAPPS_PUBLIC_MCP_URL`, `CONTROL_PLANE_HOST` und
 * `OPENAPPS_PLUGIN_MARKETPLACE`. Als offener Record, damit `process.env` passt.
 */
export type LoslegenEnv = Readonly<Record<string, string | undefined>>;

/**
 * Die Adresse, unter der Assistenten den Plattform-MCP erreichen. Aus der
 * Konfiguration, nicht aus dem Request: Hinter dem Proxy steht im Host-Header
 * nicht verlässlich, was außen gilt.
 */
export function publicMcpUrl(env: LoslegenEnv = process.env): string {
  const explicit = env.OPENAPPS_PUBLIC_MCP_URL?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  const host = env.CONTROL_PLANE_HOST?.trim();
  return host === undefined || host === '' ? '/mcp' : `https://${host}/mcp`;
}

export interface LoslegenSchritt {
  readonly titel: string;
  readonly text: string;
  /** Befehle zum Kopieren, je einer pro Zeile. */
  readonly befehle?: readonly string[];
  /** Aufzählung unter dem Text. */
  readonly punkte?: readonly string[];
  /** Verweis innerhalb der Verwaltung. */
  readonly verweis?: { readonly text: string; readonly href: string };
}

export function loslegenSchritte(env: LoslegenEnv = process.env): readonly LoslegenSchritt[] {
  const mcpUrl = publicMcpUrl(env);
  const marketplace = env.OPENAPPS_PLUGIN_MARKETPLACE?.trim() || 'jonasqz/openapps';
  return [
    {
      titel: 'Plugin installieren',
      text: 'In Claude Code, einmal. Das Plugin bringt die Verbindung zur Plattform, ihre Regeln als Skill und drei Befehle mit.',
      befehle: [`/plugin marketplace add ${marketplace}`, '/plugin install openapps@openapps'],
    },
    {
      titel: 'Eigenen Zugang anlegen',
      text: 'Jeder Assistent bekommt einen eigenen Agent-Zugang. Das Token erscheint beim Anlegen genau einmal. Es gehört in deine Umgebung, nicht in ein Repo und nicht in einen Chat. Ohne Recht dazu legt ihn jemand aus platform-admins für dich an.',
      verweis: { text: 'Zu den Agents', href: '/agents' },
    },
    {
      titel: 'Verbinden',
      text: 'Setze Adresse und Token in deiner Shell und starte Claude Code. Mit /openapps:status siehst du, was dein Zugang darf.',
      befehle: [
        `export OPENAPPS_MCP_URL="${mcpUrl}"`,
        'export OPENAPPS_TOKEN="<dein Token>"',
        'claude',
      ],
    },
    {
      titel: 'Apps bauen und ändern',
      text: 'Sag deinem Assistenten, was du brauchst. Er hält sich an die Regeln der Plattform und fragt vor dem Anlegen nach.',
      befehle: [
        '/openapps:neue-app Urlaubsanträge mit Genehmigung durch die Teamleitung',
        '/openapps:app-aendern crm Feld „Lead-Quelle“ an Deals',
        '/openapps:status',
      ],
    },
    {
      titel: 'Was dann passiert',
      text: 'Jeder Schritt geht durch die Plattform, nichts daran vorbei.',
      punkte: [
        'create_app legt die App aus der Vorlage an, mit eigenem Schema und eigener Datenbank-Rolle.',
        'Jeder neue Stand geht durch das Review-Gate (gitleaks, semgrep, Prüfungen der Plattform). Befunde werden behoben, nicht umgangen.',
        'Live ist die App erst nach dem Review. Sehen kann sie erst, wer eine Freigabe hat. Was nicht freigegeben ist, ist gesperrt.',
        'Jeder Aufruf deines Assistenten steht im Audit-Log, auch die abgelehnten.',
      ],
    },
    {
      titel: 'Ohne Claude Code',
      text: 'Jeder Assistent, der MCP spricht, kann sich verbinden. Die Regeln für das Bauen liefert der Prompt how_to_build_app, diese Anleitung der Prompt loslegen.',
      punkte: [`Adresse: ${mcpUrl}`, 'Header: Authorization: Bearer <dein Token>'],
    },
  ];
}

/** Dieselben Schritte als Markdown, für den MCP-Prompt `loslegen`. */
export function loslegenAlsText(env: LoslegenEnv = process.env): string {
  const teile = loslegenSchritte(env).map((schritt, i) => {
    const zeilen = [`## ${String(i + 1)}. ${schritt.titel}`, '', schritt.text];
    if (schritt.befehle !== undefined) zeilen.push('', '```', ...schritt.befehle, '```');
    if (schritt.punkte !== undefined) zeilen.push('', ...schritt.punkte.map((p) => `- ${p}`));
    if (schritt.verweis !== undefined) {
      zeilen.push('', `${schritt.verweis.text}: ${schritt.verweis.href} in der Verwaltung.`);
    }
    return zeilen.join('\n');
  });
  return [
    '# Loslegen: Apps mit dem eigenen Assistenten bauen',
    '',
    ...teile.flatMap((t) => [t, '']),
  ].join('\n');
}
