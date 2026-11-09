import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  Spinner,
  Table,
  Tabs,
  useToast,
} from '../src/index.ts';
import { DetailPattern, FormPattern, ListPattern } from '../src/index.ts';
import { AppShell } from '../src/shell/AppShell.tsx';
import type { ShellApp, ShellNavGroup, ShellNotification, ShellUser } from '../src/shell/types.ts';

type Theme = 'system' | 'light' | 'dark';

const LONG =
  'Ein absichtlich sehr langer Text ohne Leerzeichen dahinter: ' +
  'Dienstreisekostenabrechnungsgenehmigungsverfahrensbeschreibung';

const USER: ShellUser = {
  id: 'u-1',
  email: 'anna.beispiel@firma.de',
  name: 'Anna Beispiel',
  groups: ['vertrieb', 'alle'],
};

const APPS: readonly ShellApp[] = [
  { id: 'urlaub', name: 'Urlaub', href: '#urlaub', category: 'Personal', current: true },
  { id: 'spesen', name: 'Spesen', href: '#spesen', category: 'Personal' },
  { id: 'crm', name: 'Kunden', href: '#crm', category: 'Vertrieb' },
  { id: 'angebote', name: 'Angebote', href: '#angebote', category: 'Vertrieb' },
  { id: 'inventar', name: 'Inventar', href: '#inventar', category: 'Betrieb' },
];

const NAV: readonly ShellNavGroup[] = [
  {
    title: 'Urlaub',
    items: [
      { id: 'offen', label: 'Offene Anträge', href: '#offen', badge: 3, current: true },
      { id: 'alle', label: 'Alle Anträge', href: '#alle' },
      { id: 'kalender', label: 'Kalender', href: '#kalender' },
      { id: 'lang', label: LONG, href: '#lang' },
    ],
  },
  {
    title: 'Verwaltung',
    items: [
      { id: 'regeln', label: 'Regeln', href: '#regeln' },
      { id: 'export', label: 'Export', href: '#export', badge: 120 },
    ],
  },
];

const NOTIFICATIONS: readonly ShellNotification[] = [
  { id: 'n1', title: 'Antrag genehmigt', at: '09.11.2026 09:00', body: 'Sommerurlaub 01.07.–14.07.', read: false },
  { id: 'n2', title: 'Neue Spesenregel', at: '08.11.2026 17:30', body: LONG, read: false },
  { id: 'n3', title: 'Export fertig', at: '07.11.2026 12:00', read: true },
];

interface Row {
  id: string;
  name: string;
  art: string;
  status: 'offen' | 'genehmigt' | 'abgelehnt';
  tage: number;
}

const ROWS: readonly Row[] = [
  { id: '1', name: 'Anna Beispiel', art: 'Urlaub', status: 'offen', tage: 10 },
  { id: '2', name: 'Bert Beispiel', art: 'Gleitzeit', status: 'genehmigt', tage: 2 },
  { id: '3', name: LONG, art: 'Sonderurlaub', status: 'abgelehnt', tage: 1 },
  { id: '4', name: 'Dora Beispiel', art: 'Urlaub', status: 'genehmigt', tage: 21 },
];

const STATUS_TONE = { offen: 'warning', genehmigt: 'success', abgelehnt: 'danger' } as const;

const COLUMNS = [
  { key: 'name', header: 'Name', cell: (row: Row) => row.name, className: 'w-2/5' },
  { key: 'art', header: 'Art', cell: (row: Row) => row.art, hideBelow: 'sm' as const },
  {
    key: 'status',
    header: 'Status',
    cell: (row: Row) => (
      <Badge tone={STATUS_TONE[row.status]} srPrefix="Status: ">
        {row.status}
      </Badge>
    ),
  },
  { key: 'tage', header: 'Tage', cell: (row: Row) => row.tage, align: 'right' as const, hideBelow: 'md' as const },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section id={id} className="flex min-w-0 flex-col gap-4 scroll-mt-20">
      <h2 className="border-b border-border pb-1 text-xl font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Demo({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</p>
      <div className="min-w-0 rounded-lg border border-border bg-bg p-3">{children}</div>
    </div>
  );
}

function ThemeSwitch({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Darstellung">
      {(['system', 'light', 'dark'] as const).map((value) => (
        <Button
          key={value}
          size="sm"
          variant={theme === value ? 'primary' : 'secondary'}
          aria-pressed={theme === value}
          onClick={() => onChange(value)}
        >
          {value === 'system' ? 'System' : value === 'light' ? 'Hell' : 'Dunkel'}
        </Button>
      ))}
    </div>
  );
}

function ToastDemo(): JSX.Element {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => toast.show({ title: 'Gespeichert', tone: 'success' })}>
        Erfolg
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => toast.show({ title: 'Prüfung läuft', description: 'Das kann dauern.', tone: 'info' })}
      >
        Hinweis
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={() => toast.show({ title: 'Nicht gespeichert', description: LONG, tone: 'danger', duration: 0 })}
      >
        Fehler
      </Button>
    </div>
  );
}

function Content(): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const filtered = ROWS.filter(
    (row) =>
      row.name.toLowerCase().includes(search.toLowerCase()) && (status === '' || row.status === status),
  );

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <Section id="komponenten" title="Komponenten">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Demo label="Button — alle Varianten und Zustände">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Primär</Button>
              <Button variant="secondary">Sekundär</Button>
              <Button variant="ghost">Still</Button>
              <Button variant="danger">Löschen</Button>
              <Button disabled>Deaktiviert</Button>
              <Button loading>Lädt</Button>
              <Button size="sm">Klein</Button>
              <Button size="lg">Groß</Button>
            </div>
            <div className="mt-2 max-w-xs">
              <Button fullWidth>{LONG}</Button>
            </div>
          </Demo>

          <Demo label="Badge und Spinner">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>neutral</Badge>
              <Badge tone="primary">primär</Badge>
              <Badge tone="success">genehmigt</Badge>
              <Badge tone="warning">offen</Badge>
              <Badge tone="danger">abgelehnt</Badge>
              <Spinner size="sm" />
              <Spinner />
              <Spinner size="lg" />
            </div>
            <div className="mt-2 max-w-[10rem]">
              <Badge tone="primary">{LONG}</Badge>
            </div>
          </Demo>

          <Demo label="Input, Select, Checkbox — normal, Hilfe, Fehler, leer, deaktiviert">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Name" placeholder="Vor- und Nachname" />
              <Input label="E-Mail" hint="Dienstliche Adresse" defaultValue="anna@firma.de" />
              <Input label="Tage" error="Bitte eine Zahl angeben." defaultValue="viele" required />
              <Input label="Gesperrt" disabled defaultValue="unveränderlich" />
              <Select
                label="Art"
                placeholder="Bitte wählen"
                options={[
                  { value: 'urlaub', label: 'Urlaub' },
                  { value: 'gleitzeit', label: 'Gleitzeit' },
                  { value: 'sonder', label: 'Sonderurlaub (nur mit Nachweis)' },
                ]}
              />
              <Select label="Leer" options={[]} />
              <Checkbox label="Richtlinie gelesen" defaultChecked />
              <Checkbox label={LONG} error="Bitte bestätigen." />
            </div>
          </Demo>

          <Demo label="Card">
            <Card>
              <CardHeader
                title="Antrag URL-2026-014"
                description="Sommerurlaub, 10 Tage"
                actions={<Button size="sm" variant="secondary">Bearbeiten</Button>}
              />
              <CardBody>
                <p className="text-sm text-fg-muted">{LONG}</p>
              </CardBody>
              <CardFooter>
                <Button size="sm">Genehmigen</Button>
                <Button size="sm" variant="ghost">Ablehnen</Button>
              </CardFooter>
            </Card>
          </Demo>

          <Demo label="Tabs">
            <Tabs
              label="Beispiel-Reiter"
              items={[
                { id: 'a', label: 'Offen', count: 3, content: <p className="text-sm text-fg-muted">Drei offene Anträge.</p> },
                { id: 'b', label: 'Erledigt', count: 128, content: <p className="text-sm text-fg-muted">Alles erledigt.</p> },
                { id: 'c', label: 'Gesperrt', disabled: true, content: <p>unerreichbar</p> },
                { id: 'd', label: LONG.slice(0, 40), content: <p className="text-sm text-fg-muted">Langer Reitername.</p> },
              ]}
            />
          </Demo>

          <Demo label="Toast und Dialog">
            <div className="flex flex-col gap-3">
              <ToastDemo />
              <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
                Dialog öffnen
              </Button>
            </div>
            <Dialog
              open={dialogOpen}
              onClose={() => setDialogOpen(false)}
              role="alertdialog"
              title="Antrag löschen?"
              description="Das lässt sich nicht zurücknehmen."
              footer={
                <>
                  <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                    Abbrechen
                  </Button>
                  <Button variant="danger" onClick={() => setDialogOpen(false)}>
                    Löschen
                  </Button>
                </>
              }
            >
              <p className="text-sm text-fg-muted">{LONG}</p>
            </Dialog>
          </Demo>

          <Demo label="Table — normal, lädt, Fehler, leer">
            <div className="flex flex-col gap-4">
              <Table caption="Anträge" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} onRowActivate={() => {}} />
              <Table caption="Lädt" columns={COLUMNS} rows={[]} rowKey={(row) => row.id} loading />
              <Table
                caption="Leer"
                columns={COLUMNS}
                rows={[]}
                rowKey={(row) => row.id}
                empty={{ title: 'Noch keine Anträge', description: 'Der erste Antrag erscheint hier.' }}
              />
              <Table
                caption="Fehler"
                columns={COLUMNS}
                rows={[]}
                rowKey={(row) => row.id}
                error={{ title: 'Anträge nicht geladen', description: 'Das Gateway antwortet nicht.' }}
              />
            </div>
          </Demo>

          <Demo label="Pagination">
            <div className="flex flex-col gap-4">
              <Pagination page={page} pageSize={20} total={1234} onPageChange={setPage} />
              <Pagination page={1} pageSize={20} total={0} onPageChange={() => {}} />
            </div>
          </Demo>
        </div>
      </Section>

      <Section id="muster" title="Muster">
        <Demo label="Muster 1 — Liste mit Filter">
          <ListPattern
            title="Anträge"
            description="Alle Urlaubsanträge Ihres Bereichs."
            actions={<Button size="sm">Neuer Antrag</Button>}
            columns={COLUMNS}
            rows={filtered}
            rowKey={(row) => row.id}
            onRowActivate={() => {}}
            search={{ label: 'Suche', value: search, onChange: setSearch }}
            filters={[
              {
                id: 'status',
                label: 'Status',
                value: status,
                onChange: setStatus,
                options: [
                  { value: '', label: 'Alle' },
                  { value: 'offen', label: 'Offen' },
                  { value: 'genehmigt', label: 'Genehmigt' },
                  { value: 'abgelehnt', label: 'Abgelehnt' },
                ],
              },
            ]}
            filtersActive={search !== '' || status !== ''}
            onResetFilters={() => {
              setSearch('');
              setStatus('');
            }}
            empty={{ title: 'Noch keine Anträge' }}
            emptyFiltered={{ title: 'Kein Treffer', description: 'Die Filter sind zu eng gesetzt.' }}
            page={1}
            pageSize={20}
            total={1234}
            onPageChange={() => {}}
          />
        </Demo>

        <Demo label="Muster 2 — Formular mit Validierung am Feld">
          <FormPattern
            title="Neuer Antrag"
            description="Pflichtfelder sind mit * markiert."
            columns={2}
            fields={[
              { kind: 'text', name: 'titel', label: 'Titel', required: true, hint: 'Kurz und erkennbar.' },
              { kind: 'email', name: 'mail', label: 'E-Mail für Rückfragen', required: true },
              {
                kind: 'select',
                name: 'art',
                label: 'Art',
                required: true,
                placeholder: 'Bitte wählen',
                options: [
                  { value: 'urlaub', label: 'Urlaub' },
                  { value: 'gleitzeit', label: 'Gleitzeit' },
                ],
              },
              {
                kind: 'number',
                name: 'tage',
                label: 'Tage',
                required: true,
                validate: (value) => (Number(value) > 30 ? 'Mehr als 30 Tage braucht eine Freigabe.' : undefined),
              },
              { kind: 'checkbox', name: 'ok', label: 'Ich habe die Urlaubsregeln gelesen', required: true },
            ]}
            onSubmit={() => ({ titel: 'Dieser Titel ist schon vergeben.' })}
            onCancel={() => {}}
          />
        </Demo>

        <Demo label="Muster 3 — Detailansicht">
          <DetailPattern
            title="Sommerurlaub"
            eyebrow="URL-2026-014"
            back={{ label: 'Zur Liste', onClick: () => {} }}
            meta={
              <>
                <Badge tone="warning" srPrefix="Status: ">offen</Badge>
                <Badge tone="neutral">10 Tage</Badge>
              </>
            }
            actions={
              <>
                <Button size="sm">Genehmigen</Button>
                <Button size="sm" variant="secondary">Ablehnen</Button>
              </>
            }
            sections={[
              {
                title: 'Antrag',
                fields: [
                  { label: 'Zeitraum', value: '01.07. – 14.07.2026' },
                  { label: 'Art', value: 'Urlaub' },
                  { label: 'Vertretung', value: 'Bert Beispiel' },
                  { label: 'Begründung', value: LONG, wide: true },
                ],
              },
              {
                title: 'Verlauf',
                fields: [
                  { label: 'Eingereicht', value: '09.11.2026 09:00' },
                  { label: 'Zuletzt geändert', value: '09.11.2026 09:12' },
                ],
              },
            ]}
          />
        </Demo>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Demo label="Muster 4 — leerer Zustand">
            <EmptyState
              icon="∅"
              title="Noch keine Anträge"
              description="Sobald jemand Urlaub beantragt, erscheint er hier."
              action={<Button size="sm">Neuer Antrag</Button>}
            />
          </Demo>
          <Demo label="Muster 5 — Fehlerzustand">
            <ErrorState
              title="Anträge konnten nicht geladen werden"
              description="Das Gateway hat mit 503 geantwortet. Bitte später erneut versuchen."
              correlationId="req_01JC5K8ZT3"
              action={<Button size="sm" variant="secondary">Erneut laden</Button>}
            />
          </Demo>
        </div>
      </Section>
    </div>
  );
}

export function Showcase(): JSX.Element {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <AppShell
      appName="Urlaub"
      apps={APPS}
      nav={NAV}
      user={USER}
      notifications={NOTIFICATIONS}
      onMarkAllNotificationsRead={() => {}}
      onNotificationOpen={() => {}}
      onNavigate={() => {}}
      onProfile={() => {}}
      onSignOut={() => {}}
    >
      <div className="flex min-w-0 flex-col gap-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold text-fg">@openapps/ui</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Alle Komponenten, alle fünf Muster und die App-Shell — in hell und dunkel.
            </p>
          </div>
          <ThemeSwitch theme={theme} onChange={setTheme} />
        </header>
        <Content />
      </div>
    </AppShell>
  );
}
