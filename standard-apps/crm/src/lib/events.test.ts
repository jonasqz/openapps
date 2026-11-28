import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAppManifest } from '@openapps/app-manifest';
import { parsePlatformEvent } from '@openapps/sdk';
import { CRM_EVENT_TYPES, dealClosedEvent, stepAssignedEvent, stepDueEvent, stepPath } from './events';

/**
 * Die Ereignisse des CRM (ADR 0022). Riskant: ein Typ, den das Manifest
 * nicht erklaert (die Plattform lehnt ihn ab, er steht ewig in der Outbox),
 * ein Empfaenger in falscher Form, ein Link aus der App heraus.
 */

const manifest = parseAppManifest(JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')));

const step = {
  id: '0c000000-0000-4000-8000-000000000001',
  title: 'Send the offer',
  dueOn: '2026-11-27',
  owner: 'u_sam',
  dealId: '0d000000-0000-4000-8000-000000000001',
  companyId: '0a000000-0000-4000-8000-000000000001',
  contactId: null,
};

describe('Ereignisse des CRM', () => {
  it('erklaert im Manifest genau die Typen, die der Code meldet, und beantragt emit_event', () => {
    expect((manifest.events ?? []).map((event) => event.type).sort()).toEqual([...CRM_EVENT_TYPES].sort());
    expect(manifest.requestedGrants).toContainEqual(
      expect.objectContaining({
        subjectKind: 'app',
        subjectId: 'crm',
        verb: 'execute',
        resource: { kind: 'tool', app: 'platform', name: 'emit_event' },
      }),
    );
    expect(manifest.egress.map((entry) => entry.host)).toEqual(['openapps-control-plane']);
  });

  it('meldet einen gewonnenen Deal an den Besitzer, adressiert ueber die Nutzer-Id', () => {
    const event = dealClosedEvent({ id: 'd1', title: 'ACME rollout', owner: 'u_sam' }, 'won', 'a1', 'u_anna');
    expect(event).toMatchObject({
      id: 'deal.won:a1',
      type: 'deal.won',
      title: 'Deal won: ACME rollout',
      path: '/deals/d1',
      actor: 'user:u_anna',
      audience: ['user:u_sam'],
    });
    expect(() => parsePlatformEvent(event)).not.toThrow();
    const lost = dealClosedEvent({ id: 'd1', title: 'X', owner: 'agent:sales' }, 'lost', 'a2', 'u_anna');
    expect(lost.type).toBe('deal.lost');
    expect(lost.audience).toEqual(['agent:sales']);
    expect(dealClosedEvent({ id: 'd1', title: 'X', owner: null }, 'won', 'a3', 'u').audience).toEqual([]);
  });

  it('meldet einen Schritt nur, wenn er fuer jemand anderen geplant ist', () => {
    expect(stepAssignedEvent(step, 'u_sam')).toBeNull();
    expect(stepAssignedEvent({ ...step, owner: null }, 'u_anna')).toBeNull();
    const event = stepAssignedEvent(step, 'u_anna');
    expect(event).toMatchObject({ id: `next_step.assigned:${step.id}`, audience: ['user:u_sam'] });
    expect(() => parsePlatformEvent(event)).not.toThrow();
  });

  it('meldet Faelliges einmal je Faelligkeitstag (Id mit Datum) und verlinkt in die App', () => {
    const event = stepDueEvent(step);
    expect(event?.id).toBe(`next_step.due:${step.id}:2026-11-27`);
    expect(event?.path).toBe(`/deals/${step.dealId}`);
    expect(() => parsePlatformEvent(event)).not.toThrow();
    expect(stepPath({ dealId: null, companyId: 'c1', contactId: null })).toBe('/companies/c1');
    expect(stepPath({ dealId: null, companyId: null, contactId: 'p1' })).toBe('/contacts/p1');
  });
});
