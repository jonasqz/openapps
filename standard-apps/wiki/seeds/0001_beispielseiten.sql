-- Beispielseiten einer fiktiven Firma, damit ein frisches Wiki nicht leer ist
-- und Menschen wie Agents sofort sehen, wie Seiten, Unterseiten und Tags
-- aussehen. Feste IDs, damit Unterseiten auf ihre Eltern zeigen koennen.
-- Keine echten Zugangsdaten, keine echten Personen.

insert into pages (id, parent_id, title, content_md, tags, created_by, updated_by) values
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
  null,
  'Northlight Handbook',
  $md$# Welcome to Northlight Ltd

This handbook collects everything you need for day-to-day work at **Northlight**.
It is maintained by humans and by agents. Every change is in the *history*.

## Where do I start?

- New to the team? Read the **Onboarding** page first.
- Planning time off? See the **Leave policy**.
- Missing access to a tool? See **Tools & access**.

If something is missing, add a subpage or extend the page that fits.
$md$,
  array['handbook', 'start'],
  'system:sample-data',
  'system:sample-data'
),
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000002',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
  'Onboarding',
  $md$# Your first week

Great to have you here. This list walks you through your first few days.

## Day 1

1. Pick up and set up your laptop
2. Sign in to the password manager
3. Say hello in the team channel

## By the end of the week

- Have a chat with your **onboarding buddy**
- Go through the *Tools & access* page
- Pick up a first small task from the board

> Questions are very welcome. Nobody expects you to know everything in your first week.

More about the company: [northlight.example](https://northlight.example)
$md$,
  array['onboarding', 'people'],
  'system:sample-data',
  'system:sample-data'
),
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000003',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
  'Leave policy',
  $md$# Annual leave at Northlight

Everyone working full time gets **30 days of annual leave** per calendar year. Part-time staff get a pro-rata share.

## How to request leave

1. Agree with your team who covers for you
2. Submit the request in the HR system at least **two weeks** ahead
3. Add your absence to the team calendar

## Rules

- The office is closed between 22 December and 1 January. These days count as leave.
- Unused leave expires on *31 March* of the following year.
- Please clear more than three weeks in a row with your team lead early on.
$md$,
  array['people', 'leave'],
  'system:sample-data',
  'system:sample-data'
),
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000004',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
  'Tools & access',
  $md$# Tools we use every day

This page lists **which** tools we use and **how** you get access.
Credentials never go into this wiki and are never sent around by email.

## Tools

- **Chat**: team channels for everyday work
- **Board**: tasks and projects
- **Password manager**: all shared credentials
- **openapps**: internal apps, including this wiki

## Requesting access

1. Ask in the `#it-help` channel
2. IT grants access in the password manager
3. Done, no password in plain text

If you no longer need an account, say so in `#it-help` as well.
$md$,
  array['it', 'access'],
  'system:sample-data',
  'system:sample-data'
),
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000005',
  null,
  'Meeting notes',
  $md$# Weekly meeting

Notes from the weekly meeting. New meetings are **appended** at the bottom,
so the history stays in one place.

## Meeting on 16 November

- Quarterly goals: two out of three on track
- New wiki introduced, feedback by Friday in `#wiki`
- *Open:* Who plans the end-of-year party?

## Meeting on 23 November

- End-of-year party: the sales team plans it
- Onboarding page reworked
$md$,
  array['meeting', 'notes'],
  'system:sample-data',
  'system:sample-data'
);

-- Auch die Beispielseiten haben einen ersten Eintrag im Verlauf.
insert into page_revisions (page_id, change, title, content_md, tags, edited_by, edited_at)
select id, 'create', title, content_md, tags, created_by, created_at
from pages
where id in (
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000002',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000003',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000004',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000005'
);
