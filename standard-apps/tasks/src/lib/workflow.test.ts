import { describe, expect, it } from 'vitest';
import { actorOf, describeEvent, isOverdue, planChange, STATUSES, type TaskState } from './workflow';

/**
 * Der riskante Teil des Ablaufs ohne Datenbank: Welcher Statuswechsel setzt
 * oder leert den Abschluss, was landet im Verlauf, und was ist gar keine
 * Aenderung. Dieselben Regeln prueft tasks.db.test.ts gegen Postgres.
 */

const BASE: TaskState = {
  title: 'Write the copy',
  description: '',
  status: 'todo',
  priority: 'medium',
  assignee: 'alex@example.com',
  dueDate: '2026-12-01',
  projectId: null,
  projectName: null,
};

describe('planChange: Statuswechsel', () => {
  it('setzt beim Wechsel nach Done den Abschluss, aus jedem offenen Status', () => {
    for (const from of ['todo', 'in_progress'] as const) {
      const plan = planChange({ ...BASE, status: from }, { status: 'done' });
      expect(plan.completion, from).toBe('complete');
      expect(plan.columns).toEqual({ status: 'done' });
      expect(plan.events).toEqual([{ kind: 'status', from, to: 'done' }]);
    }
  });

  it('oeffnet eine erledigte Aufgabe wieder und leert den Abschluss', () => {
    for (const to of ['todo', 'in_progress'] as const) {
      const plan = planChange({ ...BASE, status: 'done' }, { status: to });
      expect(plan.completion, to).toBe('reopen');
      expect(plan.events).toEqual([{ kind: 'status', from: 'done', to }]);
    }
  });

  it('beruehrt den Abschluss nicht zwischen To do und In progress', () => {
    expect(planChange(BASE, { status: 'in_progress' }).completion).toBeNull();
    expect(planChange({ ...BASE, status: 'in_progress' }, { status: 'todo' }).completion).toBeNull();
  });

  it('macht aus demselben Status keine Aenderung: nochmals erledigen ist ein No-op', () => {
    for (const status of STATUSES) {
      const plan = planChange({ ...BASE, status }, { status });
      expect(plan.columns, status).toEqual({});
      expect(plan.events, status).toEqual([]);
      expect(plan.completion, status).toBeNull();
    }
  });

  it('erlaubt jeden Wechsel zwischen den drei Status', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const plan = planChange({ ...BASE, status: from }, { status: to });
        expect(plan.columns.status, `${from} -> ${to}`).toBe(from === to ? undefined : to);
      }
    }
  });
});

describe('planChange: andere Felder', () => {
  it('schreibt fuer jedes geaenderte Feld genau einen Verlaufseintrag', () => {
    const plan = planChange(BASE, {
      title: 'Write the final copy',
      priority: 'high',
      assignee: 'sam@example.com',
      dueDate: null,
      description: 'Three variants.',
    });
    expect(plan.columns).toEqual({
      title: 'Write the final copy',
      priority: 'high',
      assignee: 'sam@example.com',
      due_date: null,
      description: 'Three variants.',
    });
    expect(plan.events.map((event) => event.kind).sort()).toEqual(
      ['assignee', 'description', 'due_date', 'priority', 'title'].sort(),
    );
  });

  it('nimmt die Beschreibung nicht in den Verlauf auf, nur dass sie sich aenderte', () => {
    const plan = planChange(BASE, { description: 'secret plan' });
    expect(plan.events).toEqual([{ kind: 'description', from: null, to: null }]);
  });

  it('sieht dieselbe Adresse in anderer Schreibweise nicht als neue Zuweisung', () => {
    expect(planChange(BASE, { assignee: 'Alex@Example.com' }).events).toEqual([]);
  });

  it('hebt eine Zuweisung mit null auf und vermerkt, von wem', () => {
    const plan = planChange(BASE, { assignee: null });
    expect(plan.columns).toEqual({ assignee: null });
    expect(plan.events).toEqual([{ kind: 'assignee', from: 'alex@example.com', to: null }]);
  });

  it('vermerkt beim Projekt die Namen, nicht die Ids', () => {
    const into = planChange(BASE, { projectId: 'p1', projectName: 'Website' });
    expect(into.events).toEqual([{ kind: 'project', from: null, to: 'Website' }]);
    const out = planChange({ ...BASE, projectId: 'p1', projectName: 'Website' }, { projectId: null });
    expect(out.events).toEqual([{ kind: 'project', from: 'Website', to: null }]);
  });

  it('laesst fehlende Felder in Ruhe', () => {
    expect(planChange(BASE, {})).toEqual({ columns: {}, events: [], completion: null });
  });
});

describe('isOverdue', () => {
  const today = '2026-11-27';
  it('ist ueberfaellig, wenn das Datum vor heute liegt und die Aufgabe offen ist', () => {
    expect(isOverdue({ status: 'todo', dueDate: '2026-11-26' }, today)).toBe(true);
    expect(isOverdue({ status: 'in_progress', dueDate: '2025-01-01' }, today)).toBe(true);
  });
  it('ist es nicht am Faelligkeitstag, ohne Datum oder wenn erledigt', () => {
    expect(isOverdue({ status: 'todo', dueDate: today }, today)).toBe(false);
    expect(isOverdue({ status: 'todo', dueDate: null }, today)).toBe(false);
    expect(isOverdue({ status: 'done', dueDate: '2026-01-01' }, today)).toBe(false);
  });
});

describe('actorOf', () => {
  it('nimmt fuer Agents die Kennung agent:<name>', () => {
    expect(actorOf({ id: 'agent:operations', email: 'operations@agents.invalid' })).toBe('agent:operations');
  });
  it('nimmt fuer Menschen die E-Mail, klein geschrieben', () => {
    expect(actorOf({ id: 'u_123', email: 'Alex@Example.com' })).toBe('alex@example.com');
  });
  it('faellt ohne E-Mail auf die Id zurueck', () => {
    expect(actorOf({ id: 'u_123', email: '' })).toBe('u_123');
  });
});

describe('describeEvent', () => {
  it('liest sich als englischer Satz', () => {
    expect(describeEvent({ kind: 'status', from: 'todo', to: 'done' })).toBe('moved it from To do to Done');
    expect(describeEvent({ kind: 'assignee', from: null, to: 'sam@example.com' })).toBe(
      'assigned it to sam@example.com',
    );
    expect(describeEvent({ kind: 'due_date', from: '2026-12-01', to: null })).toBe('removed the due date');
  });
});
