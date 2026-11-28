import { describe, expect, it } from 'vitest';
import { parsePlatformEvent } from '@openapps/sdk';
import { assignedEvent, commentedEvent, statusChangedEvent } from './events';

/**
 * Die Ereignisse von Tasks (ADR 0022). Riskant: ein Empfaenger in einer Form,
 * die die Plattform nicht liest, ein Ereignis ohne eindeutige Id (dann waere
 * die zweite Zuweisung ein Doppel), oder ein Ereignis, das die Plattform
 * abweisen wuerde und das deshalb ewig in der Outbox steht.
 */

const task = {
  id: '0e000000-0000-4000-8000-000000000001',
  title: 'Write the offer',
  assignee: 'Sam@Example.com',
  createdBy: 'agent:planner',
};

describe('Ereignisse von Tasks', () => {
  it('meldet eine Zuweisung an die neue Person, mit dem Ausloeser', () => {
    const event = assignedEvent(task, 'h1', 'anna@example.com');
    expect(event).toMatchObject({
      id: 'task.assigned:h1',
      type: 'task.assigned',
      object: `task:${task.id}`,
      title: 'Assigned to you: Write the offer',
      path: `/task/${task.id}`,
      actor: 'human:anna@example.com',
      audience: ['human:sam@example.com'],
    });
    expect(() => parsePlatformEvent(event)).not.toThrow();
  });

  it('meldet keine Zuweisung ohne Person', () => {
    expect(assignedEvent({ ...task, assignee: null }, 'h1', 'anna@example.com')).toBeNull();
  });

  it('adressiert Kommentar und Status an zustaendige und anlegende Person, Agenten als agent:', () => {
    const comment = commentedEvent(task, 'c1', 'agent:planner');
    expect(comment.audience).toEqual(['human:sam@example.com', 'agent:planner']);
    expect(comment.actor).toBe('agent:planner');
    const status = statusChangedEvent(task, 'h2', 'done', 'sam@example.com');
    expect(status.title).toBe('Write the offer is now Done');
    expect(status.id).toBe('task.status_changed:h2');
    for (const event of [comment, status]) expect(() => parsePlatformEvent(event)).not.toThrow();
  });

  it('kuerzt lange Titel, statt das Ereignis ungueltig zu machen', () => {
    const long = assignedEvent({ ...task, title: 'x'.repeat(200) }, 'h3', 'a@example.com');
    expect(parsePlatformEvent(long).title.length).toBe(200);
  });
});
