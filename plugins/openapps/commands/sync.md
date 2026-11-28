---
description: Sync this session with openapps, pull context before work or file results after it
argument-hint: '[pull <topic> | push]'
---

Sync this session with the openapps platform: $ARGUMENTS

openapps holds what the team keeps: tasks, wiki pages, knowledge and the team
memory. This session is where the work happens. Sync results, never the chat
itself.

Start with `whoami` so you know which tools your access allows. If a tool
you need is missing, say which grant is missing (subject, verb, resource) and
skip that part. Never grant yourself anything.

## Pick the direction

- `pull <topic>`: get context before work.
- `push`: file results after work.
- No argument: `push` if this session already produced results, otherwise
  ask me for a topic and `pull`.

## Pull

1. Call `search` with the topic. Call `recall` with the topic if you may.
2. If a hit contains references like `@{tasks:task:42}`, resolve them with
   `resolve_refs`. A `restricted` reference stays restricted; do not try to
   reach it another way.
3. Summarize in at most ten lines: what exists, what is open, which
   decisions apply. Give each item its link (`href`). Then stop and wait for my
   next instruction.

## Push

1. Go through this session and collect candidates, in four kinds:
   - **Task:** an open to-do somebody still has to do. Tool `tasks.create`
     of the app tasks (title, optional description, assignee, dueDate).
   - **Decision:** something we decided, with its reason. A wiki page with
     `pages.create` (title, contentMd), or `pages.update` on the page it belongs
     to.
   - **Team memory:** a short, lasting fact other agents should know, such as a
     convention or a contact. Tool `remember` (text, apps).
   - **Link:** two existing objects that belong together. Write the reference
     `@{app:type:id}` into the text of one of them.
2. Leave out:
   - my personal preferences and working style (they belong in my own
     assistant's memory, not the team's);
   - secrets, tokens, passwords, keys, and personal data beyond names and
     work email addresses;
   - transcripts, long code, anything half-finished;
   - anything already in openapps. Check with `search` before you propose
     it, and propose an update instead of a duplicate.
3. Show the proposal as a numbered list, one line each: kind, target app, title,
   and in brackets what it is based on. Then ask: "File all, a selection (e.g.
   1,3) or none?"
4. **Write nothing before I answer.** Then file exactly what I chose. Link new
   objects to each other with references where it helps (a decision page
   names its tasks as `@{tasks:task:<id>}`).
5. Report what you filed, with links, and anything that failed with the reason
   the platform gave.

## Tool names

App tools appear in the MCP under their resource id with the dots replaced,
for example `tasks.create` of the app tasks as `tasks__tasks__create`, with the
arguments in the field `args`. Platform tools (`whoami`, `search`, `recall`,
`remember`, `resolve_refs`) keep their names.
