/**
 * Das Onboarding: wie jemand mit dem eigenen Assistenten Apps baut und
 * ändert. Eine Quelle für zwei Wege. Die Verwaltung zeigt es als Seite
 * (`/get-started`), der Plattform-MCP gibt es als Prompt `get_started` aus. So weiß
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
      titel: 'Install the plugin',
      text: 'In Claude Code, once. The plugin brings the connection to the platform, its rules as a skill, and three commands.',
      befehle: [`/plugin marketplace add ${marketplace}`, '/plugin install openapps@openapps'],
    },
    {
      titel: 'Create your own access',
      text: 'Each assistant gets its own agent access. The token is shown exactly once, when the agent is created. It belongs in your environment, not in a repo and not in a chat. If you lack the right to create one, someone from platform-admins creates it for you.',
      verweis: { text: 'Go to Agents', href: '/agents' },
    },
    {
      titel: 'Connect',
      text: 'Set the address and token in your shell and start Claude Code. /openapps:status shows what your access may do.',
      befehle: [
        `export OPENAPPS_MCP_URL="${mcpUrl}"`,
        'export OPENAPPS_TOKEN="<your token>"',
        'claude',
      ],
    },
    {
      titel: 'Build and change apps',
      text: 'Tell your assistant what you need. It follows the platform rules and asks before creating anything.',
      befehle: [
        '/openapps:new-app Holiday requests approved by the team lead',
        '/openapps:change-app crm Add a "lead source" field to deals',
        '/openapps:status',
      ],
    },
    {
      titel: 'What happens next',
      text: 'Every step goes through the platform, nothing bypasses it.',
      punkte: [
        'create_app creates the app from the template, with its own schema and its own database role.',
        'Every new version goes through the review gate (gitleaks, semgrep, platform checks). Findings are fixed, not worked around.',
        'The app only goes live after the review. Only people with a grant can see it. Whatever is not granted is locked.',
        'Every call your assistant makes is in the audit log, including the rejected ones.',
      ],
    },
    {
      titel: 'Without Claude Code',
      text: 'Any assistant that speaks MCP can connect. The prompt how_to_build_app provides the building rules, the prompt get_started provides this guide.',
      punkte: [`Adresse: ${mcpUrl}`, 'Header: Authorization: Bearer <your token>'],
    },
  ];
}

/** Dieselben Schritte als Markdown, für den MCP-Prompt `get_started`. */
export function loslegenAlsText(env: LoslegenEnv = process.env): string {
  const teile = loslegenSchritte(env).map((schritt, i) => {
    const zeilen = [`## ${String(i + 1)}. ${schritt.titel}`, '', schritt.text];
    if (schritt.befehle !== undefined) zeilen.push('', '```', ...schritt.befehle, '```');
    if (schritt.punkte !== undefined) zeilen.push('', ...schritt.punkte.map((p) => `- ${p}`));
    if (schritt.verweis !== undefined) {
      zeilen.push('', `${schritt.verweis.text}: ${schritt.verweis.href} in the admin area.`);
    }
    return zeilen.join('\n');
  });
  return [
    '# Get started: build apps with your own assistant',
    '',
    ...teile.flatMap((t) => [t, '']),
  ].join('\n');
}
