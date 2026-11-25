import type { ReactNode } from 'react';
import { Badge, Table } from '@openapps/ui';
import { ErledigenButton } from '@/components/ErledigenButton';
import { ButtonLink } from '@/components/links';
import { listAufgaben, type Aufgabe } from '@/lib/aufgaben';

/**
 * Immer zur Laufzeit rendern, sonst rendert Next schon beim Build ohne
 * Datenbank und liefert für immer den Fehlerzustand.
 */
export const dynamic = 'force-dynamic';

/**
 * Die Aufgabenliste. Dieselbe Liste liefert das Tool `aufgaben.list`.
 * Server-Seite: Spalten nennen nur `field`, die Zellen stehen fertig in der
 * Zeile.
 */
interface AufgabeRow {
  id: string;
  titel: string;
  zustaendig: string;
  faellig: string;
  status: ReactNode;
  aktion: ReactNode;
}

function datum(iso: string): string {
  const [jahr, monat, tag] = iso.split('-');
  return `${tag}.${monat}.${jahr}`;
}

const toRow = (aufgabe: Aufgabe, heute: string): AufgabeRow => ({
  id: aufgabe.id,
  titel: aufgabe.titel,
  zustaendig: aufgabe.zustaendig,
  faellig: aufgabe.faelligAm === null ? '–' : datum(aufgabe.faelligAm),
  status: aufgabe.erledigt ? (
    <Badge tone="success">Erledigt</Badge>
  ) : aufgabe.faelligAm !== null && aufgabe.faelligAm < heute ? (
    <Badge tone="danger">Überfällig</Badge>
  ) : (
    <Badge tone="neutral">Offen</Badge>
  ),
  aktion: aufgabe.erledigt ? null : <ErledigenButton id={aufgabe.id} titel={aufgabe.titel} />,
});

export default async function AufgabenPage() {
  let aufgaben: Aufgabe[] = [];
  let failed = false;
  try {
    aufgaben = await listAufgaben({ limit: 200 });
  } catch (error) {
    console.error('[aufgaben] Liste laden:', error);
    failed = true;
  }
  const heute = new Date().toISOString().slice(0, 10);

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">Aufgaben</h1>
          <p className="mt-1 text-sm text-fg-muted">Offene zuerst, dann nach Fälligkeit.</p>
        </div>
        <ButtonLink href="/neu">Neue Aufgabe</ButtonLink>
      </header>
      <Table<AufgabeRow>
        caption="Aufgaben"
        rows={failed ? [] : aufgaben.map((aufgabe) => toRow(aufgabe, heute))}
        columns={[
          { field: 'titel', header: 'Titel' },
          { field: 'zustaendig', header: 'Zuständig' },
          { field: 'faellig', header: 'Fällig', hideBelow: 'sm' },
          { field: 'status', header: 'Status' },
          { field: 'aktion', header: 'Aktion' },
        ]}
        empty={{
          title: 'Noch keine Aufgaben',
          description: 'Lege die erste Aufgabe an, dann erscheint sie hier.',
          action: <ButtonLink href="/neu">Neue Aufgabe</ButtonLink>,
        }}
        error={
          failed
            ? {
                title: 'Aufgaben konnten nicht geladen werden',
                description: 'Die Datenbank hat nicht geantwortet. Lade die Seite neu.',
              }
            : undefined
        }
      />
    </>
  );
}
