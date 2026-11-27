import type { JSX } from 'react';
import { TextLink } from './LinkButton';

/**
 * Pfad ueber einer Seite: „All pages / Vorfahr / … / aktuelle Seite“. Die
 * aktuelle Seite ist kein Link. Der Pfad kommt aus `pages.get` (`path`).
 */
export function Breadcrumbs({
  path,
  current,
}: {
  path: ReadonlyArray<{ id: string; title: string }>;
  current?: { id: string; title: string; href?: boolean };
}): JSX.Element {
  // Kein Datenbestand, sondern die Stufen eines Pfads: Er beginnt immer mit
  // „All pages“, ist also nie leer, und es gibt nichts, das beim Laden
  // scheitern koennte — die Seite darueber hat ihren eigenen Fehlerzustand.
  const crumbs = [
    { key: 'root', node: <TextLink href="/">All pages</TextLink> },
    ...path.map((ref) => ({ key: ref.id, node: <TextLink href={`/pages/${ref.id}`}>{ref.title}</TextLink> })),
    ...(current === undefined
      ? []
      : [
          {
            key: current.id,
            node:
              current.href === true ? (
                <TextLink href={`/pages/${current.id}`}>{current.title}</TextLink>
              ) : (
                <span aria-current="page" className="text-fg-muted">
                  {current.title}
                </span>
              ),
          },
        ]),
  ];
  const items = crumbs.map((crumb, index) => (
    <li key={crumb.key} className="flex min-w-0 items-center gap-2">
      {index > 0 ? (
        <span aria-hidden="true" className="text-fg-subtle">
          /
        </span>
      ) : null}
      <span className="min-w-0 truncate">{crumb.node}</span>
    </li>
  ));
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-sm">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{items}</ol>
    </nav>
  );
}
