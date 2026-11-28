import { describe, expect, it } from 'vitest';
import { parsePlatformEvent } from '@openapps/sdk';
import { pageUpdatedEvents } from './events';

/**
 * `page.updated` (ADR 0022). Riskant: ein Ereignis mit mehr Empfaengern, als
 * die Plattform annimmt (dann stuende es ewig in der Outbox), oder eine
 * Person in einer Form, die die Plattform nicht aufloesen kann.
 */

const page = { id: '0e000000-0000-4000-8000-000000000001', title: 'Onboarding' };

describe('pageUpdatedEvents', () => {
  it('adressiert Favoriten ueber Nutzer-Id und Agenten-Namen', () => {
    const [event] = pageUpdatedEvents(page, '42', ['usr_anna', 'agent:editor', 'usr_anna'], 'usr_ben');
    expect(event).toMatchObject({
      id: 'page.updated:42',
      type: 'page.updated',
      title: 'Page changed: Onboarding',
      path: `/pages/${page.id}`,
      actor: 'user:usr_ben',
      audience: ['user:usr_anna', 'agent:editor'],
    });
    expect(() => parsePlatformEvent(event)).not.toThrow();
  });

  it('meldet nichts ohne Favoriten und teilt viele auf Ereignisse zu je 50', () => {
    expect(pageUpdatedEvents(page, '1', [], 'usr_ben')).toEqual([]);
    const many = Array.from({ length: 120 }, (_, i) => `usr_${String(i)}`);
    const events = pageUpdatedEvents(page, '7', many, 'usr_ben');
    expect(events.map((event) => event.id)).toEqual(['page.updated:7', 'page.updated:7:1', 'page.updated:7:2']);
    expect(events.map((event) => event.audience?.length)).toEqual([50, 50, 20]);
    for (const event of events) expect(() => parsePlatformEvent(event)).not.toThrow();
  });
});
