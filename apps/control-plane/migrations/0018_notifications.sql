-- 0018_notifications.sql — Benachrichtigungen, abgeleitet aus `events` (ADR 0022 C).
--
-- Eine Zeile je Empfaenger und Ereignis, angelegt in derselben Transaktion
-- wie das Ereignis. Nur fuer Subjekte, die beim Ableiten `read` auf die
-- Quell-App hatten; beim Lesen prueft `list_inbox` das noch einmal. Ein
-- Widerruf blendet die Zeile aus, er loescht sie nicht.
--
-- Der Eingang eines Menschen haengt an seiner **E-Mail**, wie die Gruppen in
-- 0009: Eine Person ist adressierbar, bevor sie sich zum ersten Mal anmeldet,
-- und eine Gruppe loest sich in E-Mails auf. Agents haengen an ihrem Namen.
-- Apps haben keinen Eingang.
--
-- Geht mit dem Ereignis (ON DELETE CASCADE), also auch mit der Aufbewahrung.
--
-- 0001 bis 0017 bleiben unveraendert.

CREATE TABLE notifications (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_seq   bigint       NOT NULL REFERENCES events (seq) ON DELETE CASCADE,
  owner_kind  text         NOT NULL CHECK (owner_kind IN ('human', 'agent')),
  owner_id    text         NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 320),
  via         text         NOT NULL CHECK (via IN ('direct', 'group')),
  via_group   text,
  state       text         NOT NULL DEFAULT 'unread' CHECK (state IN ('unread', 'read', 'done')),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CHECK ((via = 'group') = (via_group IS NOT NULL)),
  -- Immer kleingeschrieben, wie group_members.email.
  CHECK (owner_kind <> 'human' OR owner_id = lower(owner_id)),
  UNIQUE (event_seq, owner_kind, owner_id)
);

-- Der Lesepfad des Eingangs.
CREATE INDEX notifications_owner_idx ON notifications (owner_kind, owner_id, state);
