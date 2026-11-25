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
  Icon,
  Kbd,
  PageHeader,
  Skeleton,
  Stat,
  StatGroup,
} from '../src/index.ts';
import type { TableColumn } from '../src/index.ts';
import { DetailPattern, FormPattern, ListPattern } from '../src/index.ts';
import { AppShell } from '../src/shell/AppShell.tsx';
import { PlatformShell } from '../src/shell/PlatformShell.tsx';
import type {
  ShellApp,
  ShellNavGroup,
  ShellNotification,
  ShellPlatform,
  ShellUser,
} from '../src/shell/types.ts';

type Theme = 'system' | 'light' | 'dark';

const LONG =
  'A deliberately very long text without spaces after it: ' +
  'Businesstravelexpensereportapprovalprocedurespecificationdocument';

const USER: ShellUser = {
  id: 'u-1',
  email: 'anna.example@company.com',
  name: 'Anna Example',
  groups: ['sales', 'everyone'],
};

const APPS: readonly ShellApp[] = [
  { id: 'leave', name: 'Leave', href: '#leave', category: 'People', current: true },
  { id: 'expenses', name: 'Expenses', href: '#expenses', category: 'People' },
  { id: 'crm', name: 'Customers', href: '#crm', category: 'Sales' },
  { id: 'quotes', name: 'Quotes', href: '#quotes', category: 'Sales' },
  { id: 'inventory', name: 'Inventory', href: '#inventory', category: 'Operations' },
];

const NAV: readonly ShellNavGroup[] = [
  {
    title: 'Leave',
    items: [
      { id: 'open', label: 'Open requests', href: '#open', badge: 3, current: true, icon: <Icon name="home" /> },
      { id: 'all', label: 'All requests', href: '#all', icon: <Icon name="apps" /> },
      { id: 'calendar', label: 'Calendar', href: '#calendar', icon: <Icon name="book" /> },
      { id: 'lang', label: LONG, href: '#lang' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { id: 'rules', label: 'Rules', href: '#rules' },
      { id: 'export', label: 'Export', href: '#export', badge: 120 },
    ],
  },
];

const NOTIFICATIONS: readonly ShellNotification[] = [
  { id: 'n1', title: 'Request approved', at: '09/11/2026 09:00', body: 'Summer leave 01/07–14/07', read: false },
  { id: 'n2', title: 'New expense rule', at: '08/11/2026 17:30', body: LONG, read: false },
  { id: 'n3', title: 'Export ready', at: '07/11/2026 12:00', read: true },
];

interface Row {
  id: string;
  name: string;
  kind: string;
  status: 'open' | 'approved' | 'rejected';
  days: number;
}

const ROWS: readonly Row[] = [
  { id: '1', name: 'Anna Example', kind: 'Leave', status: 'open', days: 10 },
  { id: '2', name: 'Bert Example', kind: 'Flexitime', status: 'approved', days: 2 },
  { id: '3', name: LONG, kind: 'Special leave', status: 'rejected', days: 1 },
  { id: '4', name: 'Dora Example', kind: 'Leave', status: 'approved', days: 21 },
];

const STATUS_TONE = { open: 'warning', approved: 'success', rejected: 'danger' } as const;

/**
 * Spalten: `field` ist der Normalfall und serverfähig, `cell` der Sonderfall
 * für ein Element in der Zelle — und nur aus Client-Komponenten erlaubt. Das
 * Schaufenster selbst ist eine.
 */
const COLUMNS: readonly TableColumn<Row>[] = [
  { field: 'name', header: 'Name', className: 'w-2/5' },
  { field: 'kind', header: 'Type', hideBelow: 'sm' },
  {
    key: 'status',
    header: 'Status',
    cell: (row: Row) => (
      <Badge tone={STATUS_TONE[row.status]} srPrefix="Status: ">
        {row.status}
      </Badge>
    ),
  },
  { field: 'days', header: 'Days', align: 'right', hideBelow: 'md' },
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
    <div className="flex flex-wrap gap-2" role="group" aria-label="Appearance">
      {(['system', 'light', 'dark'] as const).map((value) => (
        <Button
          key={value}
          size="sm"
          variant={theme === value ? 'primary' : 'secondary'}
          aria-pressed={theme === value}
          onClick={() => onChange(value)}
        >
          {value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}
        </Button>
      ))}
    </div>
  );
}

function ToastDemo(): JSX.Element {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => toast.show({ title: 'Saved', tone: 'success' })}>
        Success
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => toast.show({ title: 'Check running', description: 'This may take a while.', tone: 'info' })}
      >
        Info
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={() => toast.show({ title: 'Not saved', description: LONG, tone: 'danger', duration: 0 })}
      >
        Error
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          toast.show({
            title: 'Grant revoked',
            action: { label: 'Undo', onClick: () => toast.show({ title: 'Grant restored', tone: 'success' }) },
          })
        }
      >
        With undo
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
      <Section id="overview" title="Overview building blocks">
        <StatGroup>
          <Stat label="Apps live" value="4" hint="1 with findings" tone="warning" href="#apps" />
          <Stat label="Agents active" value="2" hint="1 disabled" />
          <Stat label="Grants" value="18" hint="3 added this week" tone="success" />
          <Stat label="Denied calls · 24h" value="7" hint="2 from codex-team" tone="danger" />
        </StatGroup>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Demo label="Table with search, toolbar and tooltips">
            <Table
              caption="Requests"
              columns={COLUMNS}
              rows={ROWS}
              searchable
              toolbar={<Button size="sm" variant="secondary">Export</Button>}
            />
          </Demo>
          <Demo label="Skeleton, Kbd, Icon">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton />
              <Skeleton className="w-3/4" />
              <p className="text-sm text-fg-muted">
                Press <Kbd>⌘K</Kbd> to open the command palette.
              </p>
              <div className="flex flex-wrap gap-3 text-fg-muted">
                <Icon name="home" /><Icon name="apps" /><Icon name="agents" /><Icon name="grants" />
                <Icon name="groups" /><Icon name="audit" /><Icon name="plug" /><Icon name="book" />
                <Icon name="database" /><Icon name="terminal" /><Icon name="settings" /><Icon name="search" />
              </div>
            </div>
          </Demo>
        </div>
      </Section>
      <Section id="components" title="Components">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Demo label="Button — all variants and states">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Delete</Button>
              <Button disabled>Disabled</Button>
              <Button loading>Loading</Button>
              <Button size="sm">Small</Button>
              <Button size="lg">Large</Button>
            </div>
            <div className="mt-2 max-w-xs">
              <Button fullWidth>{LONG}</Button>
            </div>
          </Demo>

          <Demo label="Badge and Spinner">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>neutral</Badge>
              <Badge tone="primary">primary</Badge>
              <Badge tone="success">approved</Badge>
              <Badge tone="warning">open</Badge>
              <Badge tone="danger">rejected</Badge>
              <Spinner size="sm" />
              <Spinner />
              <Spinner size="lg" />
            </div>
            <div className="mt-2 max-w-[10rem]">
              <Badge tone="primary">{LONG}</Badge>
            </div>
          </Demo>

          <Demo label="Input, Select, Checkbox — normal, hint, error, empty, disabled">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Name" placeholder="First and last name" />
              <Input label="Email" hint="Work address" defaultValue="anna@company.com" />
              <Input label="Days" error="Please enter a number." defaultValue="many" required />
              <Input label="Locked" disabled defaultValue="unchangeable" />
              <Select
                label="Type"
                placeholder="Please choose"
                options={[
                  { value: 'leave', label: 'Leave' },
                  { value: 'flexitime', label: 'Flexitime' },
                  { value: 'special', label: 'Special leave (proof required)' },
                ]}
              />
              <Select label="Empty" options={[]} />
              <Checkbox label="Policy read" defaultChecked />
              <Checkbox label={LONG} error="Please confirm." />
            </div>
          </Demo>

          <Demo label="Card">
            <Card>
              <CardHeader
                title="Request LV-2026-014"
                description="Summer leave, 10 days"
                actions={<Button size="sm" variant="secondary">Edit</Button>}
              />
              <CardBody>
                <p className="text-sm text-fg-muted">{LONG}</p>
              </CardBody>
              <CardFooter>
                <Button size="sm">Approve</Button>
                <Button size="sm" variant="ghost">Reject</Button>
              </CardFooter>
            </Card>
          </Demo>

          <Demo label="Tabs">
            <Tabs
              label="Example tabs"
              items={[
                { id: 'a', label: 'Open', count: 3, content: <p className="text-sm text-fg-muted">Three open requests.</p> },
                { id: 'b', label: 'Done', count: 128, content: <p className="text-sm text-fg-muted">All done.</p> },
                { id: 'c', label: 'Locked', disabled: true, content: <p>unreachable</p> },
                { id: 'd', label: LONG.slice(0, 40), content: <p className="text-sm text-fg-muted">Long tab name.</p> },
              ]}
            />
          </Demo>

          <Demo label="Toast and Dialog">
            <div className="flex flex-col gap-3">
              <ToastDemo />
              <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
                Open dialog
              </Button>
            </div>
            <Dialog
              open={dialogOpen}
              onClose={() => setDialogOpen(false)}
              role="alertdialog"
              title="Delete request?"
              description="This cannot be undone."
              footer={
                <>
                  <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={() => setDialogOpen(false)}>
                    Delete
                  </Button>
                </>
              }
            >
              <p className="text-sm text-fg-muted">{LONG}</p>
            </Dialog>
          </Demo>

          <Demo label="Table — normal, loading, error, empty">
            <div className="flex flex-col gap-4">
              <Table caption="Requests" columns={COLUMNS} rows={ROWS} onRowActivate={() => {}} />
              <Table caption="Loading" columns={COLUMNS} rows={[]} loading />
              <Table
                caption="Empty"
                columns={COLUMNS}
                rows={[]}
                empty={{ title: 'No requests yet', description: 'The first request appears here.' }}
              />
              <Table
                caption="Error"
                columns={COLUMNS}
                rows={[]}
                error={{ title: 'Requests not loaded', description: 'The gateway is not responding.' }}
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

      <Section id="patterns" title="Patterns">
        <Demo label="Pattern 1 — List with filter">
          <ListPattern
            title="Requests"
            description="All leave requests in your team."
            actions={<Button size="sm">New request</Button>}
            columns={COLUMNS}
            rows={filtered}
            onRowActivate={() => {}}
            search={{ label: 'Search', value: search, onChange: setSearch }}
            filters={[
              {
                id: 'status',
                label: 'Status',
                value: status,
                onChange: setStatus,
                options: [
                  { value: '', label: 'All' },
                  { value: 'open', label: 'Open' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'rejected', label: 'Rejected' },
                ],
              },
            ]}
            filtersActive={search !== '' || status !== ''}
            onResetFilters={() => {
              setSearch('');
              setStatus('');
            }}
            empty={{ title: 'No requests yet' }}
            emptyFiltered={{ title: 'No matches', description: 'The filters are too narrow.' }}
            page={1}
            pageSize={20}
            total={1234}
            onPageChange={() => {}}
          />
        </Demo>

        <Demo label="Pattern 2 — Form with validation at the field">
          <FormPattern
            title="New request"
            description="Required fields are marked with *."
            columns={2}
            fields={[
              { kind: 'text', name: 'title', label: 'Title', required: true, hint: 'Short and recognisable.' },
              { kind: 'email', name: 'mail', label: 'Email for questions', required: true },
              {
                kind: 'select',
                name: 'kind',
                label: 'Type',
                required: true,
                placeholder: 'Please choose',
                options: [
                  { value: 'leave', label: 'Leave' },
                  { value: 'flexitime', label: 'Flexitime' },
                ],
              },
              {
                kind: 'number',
                name: 'days',
                label: 'Days',
                required: true,
                validate: (value) => (Number(value) > 30 ? 'More than 30 days needs approval.' : undefined),
              },
              { kind: 'checkbox', name: 'ok', label: 'I have read the leave policy', required: true },
            ]}
            onSubmit={() => ({ title: 'This title is already taken.' })}
            onCancel={() => {}}
          />
        </Demo>

        <Demo label="Pattern 3 — Detail view">
          <DetailPattern
            title="Summer leave"
            eyebrow="LV-2026-014"
            back={{ label: 'Back to list', href: '#patterns' }}
            meta={
              <>
                <Badge tone="warning" srPrefix="Status: ">open</Badge>
                <Badge tone="neutral">10 days</Badge>
              </>
            }
            actions={
              <>
                <Button size="sm">Approve</Button>
                <Button size="sm" variant="secondary">Reject</Button>
              </>
            }
            sections={[
              {
                title: 'Request',
                fields: [
                  { label: 'Period', value: '01/07 – 14/07/2026' },
                  { label: 'Type', value: 'Leave' },
                  { label: 'Cover', value: 'Bert Example' },
                  { label: 'Reason', value: LONG, wide: true },
                ],
              },
              {
                title: 'History',
                fields: [
                  { label: 'Submitted', value: '09/11/2026 09:00' },
                  { label: 'Last changed', value: '09/11/2026 09:12' },
                ],
              },
            ]}
          />
        </Demo>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Demo label="Pattern 4 — Empty state">
            <EmptyState
              icon="∅"
              title="No requests yet"
              description="As soon as someone requests leave, it appears here."
              action={<Button size="sm">New request</Button>}
            />
          </Demo>
          <Demo label="Pattern 5 — Error state">
            <ErrorState
              title="Requests could not be loaded"
              description="The gateway responded with 503. Please try again later."
              correlationId="req_01JC5K8ZT3"
              action={<Button size="sm" variant="secondary">Reload</Button>}
            />
          </Demo>
        </div>
      </Section>
    </div>
  );
}

/**
 * Varianten ueber die Adresse, damit jeder Zustand der Leiste direkt
 * aufrufbar ist:
 *   ?shell=app        alte AppShell mit Kopfzeile
 *   ?platform=none    keine Navigationsdaten (nur diese App)
 *   ?apps=many        viele Apps, nach Kategorie gruppiert
 *   ?user=loading     Nutzer laedt noch
 *   ?sections=none    App ohne eigene Bereiche
 */
const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);

const PLATFORM_URL = 'https://admin.example.test';

const PLATFORM_APPS: ShellPlatform['apps'] = [
  { name: 'leave', title: 'Leave', category: 'People', href: 'https://apps.example.test/leave' },
  { name: 'crm', title: 'CRM', category: 'Sales', href: 'https://apps.example.test/crm' },
  { name: 'tasks', title: 'Tasks', category: null, href: 'https://apps.example.test/tasks' },
  { name: 'expenses', title: 'Expense reports', category: 'People', href: 'https://apps.example.test/expenses' },
  // Faellt weg: keine sichere Adresse.
  { name: 'evil', title: 'Evil', category: null, href: 'javascript:alert(1)' },
];

const MANY_APPS: ShellPlatform['apps'] = [
  ...PLATFORM_APPS,
  { name: 'quotes', title: 'Quotes', category: 'Sales', href: 'https://apps.example.test/quotes' },
  { name: 'contracts', title: 'Contracts', category: 'Sales', href: 'https://apps.example.test/contracts' },
  { name: 'inventory', title: 'Inventory', category: 'Operations', href: 'https://apps.example.test/inventory' },
  { name: 'fleet', title: 'Fleet', category: 'Operations', href: 'https://apps.example.test/fleet' },
  { name: 'onboarding', title: 'Onboarding checklist for new colleagues', category: 'People', href: 'https://apps.example.test/onboarding' },
  { name: 'wiki', title: 'Wiki', category: null, href: 'https://apps.example.test/wiki' },
  { name: 'rooms', title: 'Room booking', category: 'Operations', href: 'https://apps.example.test/rooms' },
];

const PLATFORM: ShellPlatform = {
  platformUrl: PLATFORM_URL,
  apps: params.get('apps') === 'many' ? MANY_APPS : PLATFORM_APPS,
  canCreateApps: true,
  isAdmin: true,
};

const PLATFORM_SECTIONS: readonly ShellNavGroup[] = [
  {
    title: 'Requests',
    items: [
      { id: 'open', label: 'Open requests', href: '/leave', badge: 3 },
      { id: 'all', label: 'All requests', href: '/leave/all' },
      { id: 'calendar', label: 'Calendar', href: '/leave/calendar' },
      { id: 'lang', label: LONG, href: '/leave/long' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { id: 'rules', label: 'Rules', href: '/leave/rules' },
      { id: 'export', label: 'Export', href: '/leave/export', badge: 120 },
    ],
  },
];

function PlatformShowcase(): JSX.Element {
  const [path, setPath] = useState('/leave');
  const sections =
    params.get('sections') === 'none'
      ? []
      : PLATFORM_SECTIONS.map((group) => ({
          ...group,
          items: group.items.map((item) => ({ ...item, current: item.href === path })),
        }));
  return (
    <PlatformShell
      platform={params.get('platform') === 'none' ? null : PLATFORM}
      appName="leave"
      appTitle="Leave"
      sections={sections}
      user={params.get('user') === 'loading' ? null : USER}
      onNavigate={setPath}
    >
      <div className="flex min-w-0 flex-col gap-8">
        <header className="min-w-0">
          <p className="font-mono text-2xs font-medium uppercase tracking-label text-fg-muted">PlatformShell</p>
          <h1 className="mt-1 font-display text-4xl tracking-display text-fg">Open requests</h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">
            The shared sidebar every app gets (ADR 0017). Theme lives in the account menu at the bottom left.
          </p>
        </header>
        <Content />
      </div>
    </PlatformShell>
  );
}

export function Showcase(): JSX.Element {
  return params.get('shell') === 'app' ? <AppShellShowcase /> : <PlatformShowcase />;
}

function AppShellShowcase(): JSX.Element {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <AppShell
      appName="Leave"
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
        <PageHeader
          className="mb-0"
          breadcrumbs={[{ label: 'Design system', href: '#' }, { label: 'Showcase' }]}
          title="@openapps/ui"
          description="All components, all five patterns and the app shell — in light and dark."
          actions={<ThemeSwitch theme={theme} onChange={setTheme} />}
        />
        <Content />
      </div>
    </AppShell>
  );
}
