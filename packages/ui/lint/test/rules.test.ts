import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';
import { noForeignUi } from '../rules/no-foreign-ui.js';
import { requireFormStates } from '../rules/require-form-states.js';
import { noRawColor } from '../rules/no-raw-color.js';
import { requireListStates } from '../rules/require-list-states.js';
import { noServerFunctionProps } from '../rules/no-server-function-props.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

/**
 * Jede Regel hat einen Fall, der greift, und einen, der korrekten Code
 * durchlässt. Eine Regel ohne beides gehört nicht in die Config.
 */

tester.run('no-raw-color', noRawColor as never, {
  valid: [
    { code: 'const a = <div className="bg-primary text-primary-fg" />;' },
    { code: 'const a = <div className="hover:bg-surface-hover md:text-lg shadow-md border-b border-border" />;' },
    { code: 'const a = <div className={cn("bg-surface", isOn && "text-fg-muted")} />;' },
    { code: 'const a = <a href="#abc" />;' },
    { code: 'const label = "Nummer #4711";' },
  ],
  invalid: [
    {
      code: 'const a = <div className="bg-blue-500" />;',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: 'const a = <div className="bg-[#ff0000]" />;',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: 'const a = <div style={{ color: "#ff0000" }} />;',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: 'const css = "background-color: rgb(255 0 0)";',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: 'const a = <div className={cn("bg-surface", isOn && "text-emerald-600")} />;',
      errors: [{ messageId: 'forbidden' }],
    },
  ],
});

tester.run('no-foreign-ui', noForeignUi as never, {
  valid: [
    {
      // Eigener Code der App ueber Pfad-Alias ist kein Fremdpaket.
      code: `
        import { listItems } from "@/lib/items";
        import { other } from "~/lib/other";
        import { third } from "#lib/third";
        import { fourth } from "./sibling";
      `,
    },
    { code: 'import { Button } from "@openapps/ui";' },
    { code: 'import { useState } from "react";' },
    { code: 'import Link from "next/link";' },
    { code: 'import { getUser } from "@openapps/sdk";' },
    { code: 'import { helper } from "./helper.ts";' },
    {
      code: 'import { Button } from "@mantine/core";',
      options: [{ allowExtra: ['@mantine/core'] }],
    },
  ],
  invalid: [
    {
      code: 'import { Button } from "@mui/material";',
      errors: [{ messageId: 'foreign' }],
    },
    {
      code: 'import { Dialog } from "@headlessui/react";',
      errors: [{ messageId: 'foreign' }],
    },
    {
      code: 'const x = require("antd");',
      errors: [{ messageId: 'foreign' }],
    },
    {
      code: 'export { Button } from "react-bootstrap";',
      errors: [{ messageId: 'foreign' }],
    },
  ],
});

tester.run('require-list-states', requireListStates as never, {
  valid: [
    {
      code: `
        import { Table, EmptyState, ErrorState } from "@openapps/ui";
        const a = <Table caption="x" columns={[]} rows={[]} rowKey={() => ""} />;
      `,
    },
    {
      // Eine Table mit empty UND error traegt beide Zustaende selbst; ein
      // zusaetzlicher Import waere toter Code.
      code: `
        import { Table } from "@openapps/ui";
        const a = (
          <Table
            caption="x"
            columns={[]}
            rows={[]}
            rowKey={() => ""}
            empty={{ title: "Nichts da" }}
            error={{ title: "Kaputt" }}
          />
        );
      `,
    },
    {
      code: `
        import { ListPattern } from "@openapps/ui";
        const a = <ListPattern title="x" columns={[]} rows={[]} rowKey={() => ""} empty={{ title: "" }} />;
      `,
    },
    {
      code: `
        import { EmptyState, ErrorState } from "@openapps/ui";
        const a = <ul>{rows.map((row) => <li key={row.id}>{row.name}</li>)}</ul>;
      `,
    },
    {
      // Kein Datenlisten-Element: Reiter brauchen keinen leeren Zustand.
      code: 'const a = <div>{tabs.map((tab) => <button key={tab.id}>{tab.label}</button>)}</div>;',
    },
    {
      // Feste Liste im Text.
      code: 'const a = <ul><li>Eins</li><li>Zwei</li></ul>;',
    },
  ],
  invalid: [
    {
      // Nur `empty`: der Fehlerzustand fehlt, also greift die Regel weiter.
      code: `
        import { Table } from "@openapps/ui";
        const a = <Table caption="x" columns={[]} rows={[]} rowKey={() => ""} empty={{ title: "" }} />;
      `,
      errors: [{ messageId: 'missing' }],
    },
    {
      // `error={undefined}` ist kein Zustand.
      code: `
        import { Table } from "@openapps/ui";
        const a = (
          <Table caption="x" columns={[]} rows={[]} rowKey={() => ""} empty={{ title: "" }} error={undefined} />
        );
      `,
      errors: [{ messageId: 'missing' }],
    },
    {
      code: `
        import { Table } from "@openapps/ui";
        const a = <Table caption="x" columns={[]} rows={[]} rowKey={() => ""} />;
      `,
      errors: [{ messageId: 'missing' }],
    },
    {
      code: `
        import { EmptyState } from "@openapps/ui";
        const a = <Table caption="x" columns={[]} rows={[]} rowKey={() => ""} />;
      `,
      errors: [{ messageId: 'missing' }],
    },
    {
      code: 'const a = <ul>{rows.map((row) => <li key={row.id}>{row.name}</li>)}</ul>;',
      errors: [{ messageId: 'missing' }],
    },
    {
      code: `
        import { EmptyState, ErrorState } from "irgendwo";
        const a = <table><tbody>{rows.map((row) => <tr key={row.id} />)}</tbody></table>;
      `,
      errors: [{ messageId: 'missing' }],
    },
  ],
});

tester.run('require-form-states', requireFormStates as never, {
  valid: [
    {
      code: `
        import { FormPattern } from "@openapps/ui";
        const a = <FormPattern title="x" fields={[]} onSubmit={() => {}} />;
      `,
    },
    {
      // Ein Suchfeld ist kein Formular.
      code: `
        import { Input } from "@openapps/ui";
        const a = <Input label="Suche" type="search" />;
      `,
    },
    {
      // Filterleiste: zwei Felder, aber kein Absende-Pfad.
      code: `
        import { Input, Select } from "@openapps/ui";
        const a = <div><Input label="Suche" /><Select label="Status" options={[]} /></div>;
      `,
    },
    {
      // FormPattern importiert — eigene Felder daneben sind dann in Ordnung.
      code: `
        import { FormPattern, Input } from "@openapps/ui";
        const a = <form onSubmit={save}><Input label="Titel" /><Input label="Tage" /></form>;
      `,
    },
  ],
  invalid: [
    {
      code: `
        import { Input } from "@openapps/ui";
        const a = <form onSubmit={save}><Input label="Titel" /></form>;
      `,
      errors: [{ messageId: 'missing' }],
    },
    {
      // Kein <form>, aber zwei Felder und ein Absende-Knopf.
      code: `
        import { Input, Button } from "@openapps/ui";
        const a = (
          <div>
            <Input label="Titel" />
            <Input label="Tage" />
            <Button type="submit">Speichern</Button>
          </div>
        );
      `,
      errors: [{ messageId: 'missing' }],
    },
    {
      // Natives Formular mit nativen Feldern.
      code: 'const a = <form onSubmit={save}><input name="titel" /><input name="tage" /></form>;',
      errors: [{ messageId: 'missing' }],
    },
  ],
});

/**
 * Die Regel, die den Build-Fehler des Starter-Templates festnagelt: eine
 * Funktion aus einer Server-Komponente in eine Client-Komponente.
 */
tester.run('no-server-function-props', noServerFunctionProps as never, {
  valid: [
    // Serverfähige Form: Spalten mit `field`, kein `rowKey`.
    {
      filename: 'src/app/page.tsx',
      code: `import { Table } from '@openapps/ui';
export default async function Page() {
  return <Table caption="X" rows={[]} columns={[{ field: 'title', header: 'T' }]} empty={{ title: 'leer' }} />;
}`,
    },
    // Dieselbe Tabelle mit `cell` — aber in einer Client-Komponente.
    {
      filename: 'src/app/liste.tsx',
      code: `'use client';
import { Table } from '@openapps/ui';
export function Liste() {
  return <Table caption="X" rows={[]} rowKey={(r) => r.id} columns={[{ key: 't', header: 'T', cell: (r) => r.t }]} />;
}`,
    },
    // Zeilen vorher umrechnen: `toRow` wird aufgerufen, nicht übergeben.
    {
      filename: 'src/app/page.tsx',
      code: `import { Table } from '@openapps/ui';
const toRow = (item) => ({ id: item.id, titel: item.title });
export default async function Page() {
  const items = await laden();
  return <Table caption="X" rows={items.map(toRow)} columns={[{ field: 'titel', header: 'T' }]} />;
}`,
    },
    {
      filename: 'src/app/page.tsx',
      code: `import { Table } from '@openapps/ui';
export default async function Page() {
  const items = await laden();
  return <Table caption="X" rows={items.filter((i) => i.ok)} columns={[]} />;
}`,
    },
    // Eine Funktion an eine fremde Komponente ist nicht unsere Sache.
    {
      filename: 'src/app/page.tsx',
      code: `function Eigen() { return null; }
export default async function Page() { return <Eigen onPick={() => {}} />; }`,
    },
    // Keine Server-Datei: gewöhnliche Komponente ohne `async`.
    {
      filename: 'src/components/liste.tsx',
      code: `import { Table } from '@openapps/ui';
export function Liste() { return <Table caption="X" rows={[]} rowKey={(r) => r.id} columns={[]} />; }`,
    },
  ],
  invalid: [
    // Genau der Fehler aus dem Build: `rowKey` als Funktion in page.tsx.
    {
      filename: 'src/app/page.tsx',
      code: `import { Table } from '@openapps/ui';
export default async function Page() {
  return <Table caption="X" rows={[]} rowKey={(row) => row.id} columns={[]} />;
}`,
      errors: [{ messageId: 'functionProp' }],
    },
    // `cell` in einem Spalten-Literal.
    {
      filename: 'src/app/grants/page.tsx',
      code: `import { Table } from '@openapps/ui';
export default async function Page() {
  return <Table caption="X" rows={[]} columns={[{ key: 'a', header: 'A', cell: (row) => row.a }]} />;
}`,
      errors: [{ messageId: 'functionProp' }],
    },
    // `cell` in einer Konstante außerhalb des JSX — der Fall der Control Plane.
    {
      filename: 'src/app/page.tsx',
      code: `import { Table } from '@openapps/ui';
const COLUMNS = [{ key: 'a', header: 'A', cell: (row) => row.a }];
export default async function Page() {
  return <Table caption="X" rows={[]} columns={COLUMNS} />;
}`,
      errors: [{ messageId: 'functionProp' }],
    },
    // `async`-Komponente in einer Datei, die keine Seite ist.
    {
      filename: 'src/app/teile/liste.tsx',
      code: `import { ListPattern } from '@openapps/ui';
export async function Liste() {
  return <ListPattern title="X" rows={[]} columns={[]} empty={{ title: 'leer' }} onRowActivate={() => {}} />;
}`,
      errors: [{ messageId: 'functionProp' }],
    },
    // `onSubmit` am Formular: ein Formular gehört in eine Client-Datei.
    {
      filename: 'src/app/neu/page.tsx',
      code: `import { FormPattern } from '@openapps/ui';
export default async function Page() {
  return <FormPattern title="Neu" fields={[]} onSubmit={() => undefined} />;
}`,
      errors: [{ messageId: 'functionProp' }],
    },
    // `back.onClick` an der Detailansicht — `href` ist die serverfähige Form.
    {
      filename: 'src/app/detail/page.tsx',
      code: `import { DetailPattern } from '@openapps/ui';
export default async function Page() {
  return <DetailPattern title="X" sections={[]} back={{ label: 'Zurück', onClick: () => {} }} />;
}`,
      errors: [{ messageId: 'functionProp' }],
    },
  ],
});
