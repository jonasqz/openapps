/**
 * Die Uebersetzung zwischen dem Manifest und dem Rechtemodell dieser Datenbank.
 *
 * Es gibt genau einen Unterschied, und er ist ein Wort: `@openapps/app-manifest`
 * nennt den Menschen `human`, Migration 0003 nennt ihn `user`. Die Migration
 * liegt und wird nicht geaendert, das Paket ist maßgeblich fuer `app.json` —
 * also wird hier uebersetzt, an einer Stelle, mit Test.
 *
 * Alles andere ist deckungsgleich: `group`, `app`, `agent`, die drei Verben und
 * die vier Ressourcenarten.
 *
 * Gewuenschte Rechte aus dem Manifest sind ein **Antrag**, keine Freigabe. Diese
 * Datei wandelt sie nur in die Form, in der `grant` sie annehmen wuerde;
 * vergeben wird sie nie automatisch (Default-Deny).
 */

import type { RequestedGrant } from '@openapps/app-manifest';
import { ValidationError } from './errors';
import type { ResourceRef, SubjectKind, Verb } from './types';

/** `human` → `user`. Jeder andere Wert geht unveraendert durch. */
export function subjectKindOf(manifestKind: RequestedGrant['subjectKind']): SubjectKind {
  return manifestKind === 'human' ? 'user' : manifestKind;
}

/**
 * Baut die Ressourcen-Id dieser Domaene: `<app>` fuer eine App,
 * `<app>.<name>` fuer Tabelle, View und Tool — genau die Form, die
 * `parseObjectResourceId` erwartet.
 */
export function resourceRefOf(ref: RequestedGrant['resource']): ResourceRef {
  if (ref.kind === 'app') {
    return { kind: 'app', id: ref.app };
  }
  if (ref.name === undefined) {
    throw new ValidationError(`Ressource "${ref.kind}" im Manifest hat keinen Namen`);
  }
  return { kind: ref.kind, id: `${ref.app}.${ref.name}` };
}

export interface ProposedGrant {
  readonly subjectKind: SubjectKind;
  /** Offen, wenn das Manifest die Gruppe erst bei der Installation erfragt. */
  readonly subjectId: string | undefined;
  readonly verb: Verb;
  readonly resource: ResourceRef;
  readonly reason: string;
}

/** Die Antraege eines Manifests, in der Sprache dieser Domaene. */
export function proposedGrantsOf(requested: readonly RequestedGrant[]): readonly ProposedGrant[] {
  return requested.map((entry) => ({
    subjectKind: subjectKindOf(entry.subjectKind),
    subjectId: entry.subjectId,
    verb: entry.verb,
    resource: resourceRefOf(entry.resource),
    reason: entry.reason,
  }));
}
