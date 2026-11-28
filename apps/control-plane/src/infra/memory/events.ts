/**
 * Ereignisse, Benachrichtigungen und Cursor im Prozess (ADR 0022) — fuer die
 * Tests der Domaene. Dieselbe Semantik wie `src/infra/pg/events.ts`: Doppel
 * je App, ein Eingang je Empfaenger, Reihenfolge aus `compareInboxRows`,
 * Cursor nur vorwaerts.
 */

import { compareInboxRows } from '../../domain/events';
import type {
  DirectoryUser,
  EventRepository,
  InboxOwner,
  InboxRow,
  NotificationState,
  StoredEvent,
  UserDirectory,
} from '../../domain/ports';

interface MemoryNotification {
  id: string;
  seq: number;
  owner: InboxOwner;
  via: 'direct' | 'group';
  viaGroup: string | null;
  state: NotificationState;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryEventRepository extends EventRepository {
  /** Alle gespeicherten Ereignisse, fuer Tests. */
  readonly storedEvents: readonly StoredEvent[];
  /** Alle Benachrichtigungen, fuer Tests (auch ausgeblendete). */
  readonly storedNotifications: readonly Readonly<MemoryNotification>[];
}

export function createMemoryEventRepository(options: { now: () => Date }): MemoryEventRepository {
  const events: StoredEvent[] = [];
  const notifications: MemoryNotification[] = [];
  const cursors = new Map<string, number>();
  let seq = 0;
  let counter = 0;
  const notificationId = (): string => {
    counter += 1;
    return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
  };
  const sameOwner = (a: InboxOwner, b: InboxOwner): boolean => a.kind === b.kind && a.id === b.id;
  const cursorKey = (subscriber: string, app: string, type: string): string =>
    `${subscriber}\u0000${app}\u0000${type}`;

  const repo: MemoryEventRepository = {
    get storedEvents() {
      return events;
    },
    get storedNotifications() {
      return notifications;
    },
    async exists(app, eventId) {
      return events.some((e) => e.app === app && e.eventId === eventId);
    },
    async insert(event, recipients) {
      if (events.some((e) => e.app === event.app && e.eventId === event.eventId)) return null;
      seq += 1;
      const stored: StoredEvent = { ...event, seq, receivedAt: options.now() };
      events.push(stored);
      for (const recipient of recipients) {
        if (notifications.some((n) => n.seq === seq && sameOwner(n.owner, recipient))) continue;
        notifications.push({
          id: notificationId(),
          seq,
          owner: { kind: recipient.kind, id: recipient.id },
          via: recipient.via,
          viaGroup: recipient.viaGroup,
          state: 'unread',
          createdAt: stored.receivedAt,
          updatedAt: stored.receivedAt,
        });
      }
      return stored;
    },
    async inboxApps(owner) {
      const names = new Set<string>();
      for (const n of notifications) {
        if (!sameOwner(n.owner, owner)) continue;
        const event = events.find((e) => e.seq === n.seq);
        if (event !== undefined) names.add(event.app);
      }
      return [...names].sort();
    },
    async listInbox(query) {
      const rows: InboxRow[] = [];
      for (const n of notifications) {
        if (!sameOwner(n.owner, query.owner) || !query.states.includes(n.state)) continue;
        const event = events.find((e) => e.seq === n.seq);
        if (event === undefined || !query.apps.includes(event.app)) continue;
        rows.push({
          id: n.id,
          state: n.state,
          via: n.via,
          viaGroup: n.viaGroup,
          createdAt: n.createdAt,
          event,
        });
      }
      return rows.sort(compareInboxRows).slice(0, query.limit);
    },
    async countInbox(owner, apps, state) {
      return notifications.filter((n) => {
        if (!sameOwner(n.owner, owner) || n.state !== state) return false;
        const event = events.find((e) => e.seq === n.seq);
        return event !== undefined && apps.includes(event.app);
      }).length;
    },
    async markInbox(owner, ids, apps, state, at) {
      let updated = 0;
      for (const n of notifications) {
        if (!ids.includes(n.id) || !sameOwner(n.owner, owner)) continue;
        const event = events.find((e) => e.seq === n.seq);
        if (event === undefined || !apps.includes(event.app)) continue;
        n.state = state;
        n.updatedAt = at;
        updated += 1;
      }
      return updated;
    },
    async pollEvents(input) {
      return events
        .filter((event) =>
          input.subscriptions.some(
            (sub) =>
              sub.app === event.app &&
              sub.type === event.type &&
              event.seq > (cursors.get(cursorKey(input.subscriber, sub.app, sub.type)) ?? 0),
          ),
        )
        .sort((a, b) => a.seq - b.seq)
        .slice(0, input.limit);
    },
    async ackEvents(input) {
      for (const sub of input.subscriptions) {
        const key = cursorKey(input.subscriber, sub.app, sub.type);
        cursors.set(key, Math.max(cursors.get(key) ?? 0, input.upTo));
      }
      return input.subscriptions.length;
    },
    async maxSeq() {
      return seq;
    },
    async purgeReceivedBefore(cutoff) {
      const expired = new Set(
        events.filter((e) => e.receivedAt.getTime() < cutoff.getTime()).map((e) => e.seq),
      );
      const before = notifications.length;
      for (let i = notifications.length - 1; i >= 0; i -= 1) {
        if (expired.has(notifications[i]!.seq)) notifications.splice(i, 1);
      }
      const eventsBefore = events.length;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (expired.has(events[i]!.seq)) events.splice(i, 1);
      }
      return { events: eventsBefore - events.length, notifications: before - notifications.length };
    },
  };
  return repo;
}

export interface MemoryUserDirectory extends UserDirectory {
  /** Fuer Tests: eine Person, die sich angemeldet hat. */
  add(user: DirectoryUser): void;
}

export function createMemoryUserDirectory(): MemoryUserDirectory {
  const users = new Map<string, DirectoryUser>();
  return {
    add(user) {
      users.set(user.id, { ...user, email: user.email.toLowerCase() });
    },
    async findById(id) {
      return users.get(id) ?? null;
    },
    async findByEmail(email) {
      const normalized = email.trim().toLowerCase();
      return [...users.values()].find((user) => user.email === normalized) ?? null;
    },
  };
}
