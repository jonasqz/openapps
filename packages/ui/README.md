# @openapps/ui

The openapps design system: tokens, components, patterns, app shell and the
UI linter. The decision behind it: [ADR 0002 — Weg A](../../docs/decisions/0002-ui-weg-a.md).

An app imports **only** from this package. No second UI library, no custom
colour values. The linter blocks both.

## Setup

The package ships **as source code** (`exports` point to `src/`) — like
shadcn/ui. Next apps therefore need:

```js
// next.config.js
export default { transpilePackages: ['@openapps/ui'] };
```


```ts
// tailwind.config.js
import preset from '@openapps/ui/tailwind-preset';
export default { presets: [preset], content: ['./app/**/*.{ts,tsx}'] };
```

```ts
// app/layout.tsx
import '@openapps/ui/tokens.css';
```

```js
// eslint.config.js
import openappsUi from '@openapps/ui/eslint-config';
export default [...openappsUi];
```

```tsx
import { AppShell, ListPattern, Button } from '@openapps/ui';
```

## What is in it

| Part | Export | Content |
| --- | --- | --- |
| Tokens | `@openapps/ui/tokens`, `@openapps/ui/tokens.css` | colours, spacing, sizes, type, radii, shadows, z-layers |
| Tailwind preset | `@openapps/ui/tailwind-preset` | replaces Tailwind's palettes with the tokens |
| Components | `@openapps/ui` | Button, Input, Select, Checkbox, Table (with `searchable` and `toolbar`), Dialog, Toast, Badge, Card, Tabs, Pagination, EmptyState, ErrorState, Spinner, PageHeader, Stat, StatGroup, Icon, Kbd, Skeleton |
| Patterns | `@openapps/ui` | ListPattern, FormPattern, DetailPattern, EmptyState, ErrorState |
| App shell | `@openapps/ui` | PlatformShell (shared sidebar, ADR 0017), AppShell (with ⌘K command palette), AppSwitcher, UserMenu, NotificationBell, CommandPalette |
| Strings | `@openapps/ui` | `strings`, `overrideStrings`, `defaultStrings` |
| Linter | `@openapps/ui/eslint-config`, `@openapps/ui/lint/rules` | `no-raw-color`, `no-foreign-ui`, `require-list-states`, `require-form-states`, `no-server-function-props` |

## Tokens: one source

`src/tokens/tokens.ts` is the **only** source. Generated from it:

- `src/tokens/tokens.css` — CSS variables on `:root`, dark under
  `@media (prefers-color-scheme: dark)` **and** `[data-theme="dark"]`, light
  forceable via `[data-theme="light"]`.
- `tailwind/preset.js` — the same tokens as a Tailwind theme.

```bash
pnpm --filter @openapps/ui tokens
```

Both files are checked in; `tokens.generated.test.ts` regenerates them in the
test and compares — so they cannot drift apart.

Because the preset **replaces** Tailwind's palettes, `bg-blue-500` does not
exist at all. Neither does `w-60`: the spacing scale ends at `6rem`. Layout
widths are called `w-nav`, `w-drawer`, `w-menu`, `w-panel`, `max-h-scroll`,
`max-w-field`.

**Type:** system stacks only. No self-hosted font and none loaded from Google
— that would be operations v1 does not need to carry, and a Google Fonts
request would be network traffic past the gateway (rule 7). Three roles:
`font-sans` (grotesque, everything readable), `font-mono` (ids, numbers,
uppercase labels) and `font-display` (serif, page titles and large numbers
only).

**Direction** ([ADR 0010](../../docs/decisions/0010-design-schwarz-weiss-blaugrau.md)):
black and white with exactly one accent colour, blue-grey (`primary`).
Surfaces are nearly square and separated by hairlines (`border`), not by
shadows. Buttons are pills. Mono labels: `font-mono text-2xs uppercase tracking-label`.

## Contrast (calculated, not claimed)

WCAG 2.1 AA requires 4.5:1 for text and 3:1 for borders of controls.
Calculated with `contrastRatio()` from this package, recorded in
`src/tokens/tokens.contrast.test.ts` (59 checks, light and dark).

| Pair | light | dark |
| --- | --- | --- |
| `fg` on `bg` | 19.67:1 | 17.55:1 |
| `fg` on `surface` | 18.85:1 | 16.57:1 |
| `fg-muted` on `bg` | 7.33:1 | 8.10:1 |
| `fg-muted` on `surface` | 7.02:1 | 7.64:1 |
| `fg-subtle` on `bg` | 5.32:1 | 6.03:1 |
| `fg-subtle` on `surface` | 5.10:1 | 5.69:1 |
| `primary` on `bg` | 6.74:1 | 8.59:1 |
| `primary-fg` on `primary` | 6.74:1 | 8.44:1 |
| `primary-subtle-fg` on `primary-subtle` | 8.38:1 | 10.72:1 |
| `success-fg` on `success` | 6.91:1 | 9.02:1 |
| `success-subtle-fg` on `success-subtle` | 8.16:1 | 11.03:1 |
| `warning-fg` on `warning` | 6.36:1 | 8.76:1 |
| `warning-subtle-fg` on `warning-subtle` | 7.89:1 | 11.46:1 |
| `danger` on `bg` | 6.93:1 | 8.36:1 |
| `danger-fg` on `danger` | 6.93:1 | 7.85:1 |
| `danger-subtle-fg` on `danger-subtle` | 8.02:1 | 10.97:1 |
| `border-strong` on `bg` (3:1 suffices) | 3.46:1 | 3.99:1 |
| `border-strong` on `surface` (3:1 suffices) | 3.31:1 | 3.77:1 |
| `focus` on `bg` (3:1 suffices) | 6.74:1 | 8.59:1 |
| `focus` on `surface` (3:1 suffices) | 6.46:1 | 8.11:1 |

`border` (the quiet separator) is deliberately low-contrast and never carries
information — controls use `border-strong`.

## Strings

The product language is English, with no second language
([ADR 0016](../../docs/decisions/0016-produktsprache-englisch.md)) — **but no
fixed text lives in a component.** All strings are in `src/strings.ts` as one
typed object (`UiStrings`). Adding languages later means swapping that module,
not rebuilding every component.

```ts
import { overrideStrings } from '@openapps/ui';

overrideStrings({
  form: { submit: 'Submit request' },
  shell: { productName: 'Example Ltd' },
});
```

Strings not mentioned stay unchanged. Where a component already has a text
prop (`loadingLabel`, `emptyLabel`, `signedOutLabel`, …), the prop wins.
`defaultStrings` are the shipped strings, `resetStrings()` restores them.

`src/strings.test.ts` scans the sources of `components/`, `patterns/` and
`shell/` to make sure no visible text is hard-coded there — with five nets
(text in JSX, strings on text props, defaults after `??`, anything with an
umlaut or typographic character, error texts). Each net has a test that shows
it catches, and one that lets correct code through.

## The linter

| Rule | Blocks |
| --- | --- |
| `no-raw-color` | hex, `rgb()`/`hsl()`/`oklch()`, `bg-[#fff]`, Tailwind colour classes outside the tokens |
| `no-foreign-ui` | imports outside the allowlist (`@openapps/ui`, `@openapps/sdk`, `@openapps/app-manifest`, `react`, `react-dom`, `next`, Tailwind) |
| `require-list-states` | a list (`Table`, `ListPattern`, `.map` in `ul`/`ol`/`tbody`) without an imported `EmptyState` **and** `ErrorState` — `ListPattern` counts as both |
| `require-form-states` | a form without an imported `FormPattern` |
| `no-server-function-props` | a function passed to `Table`, `ListPattern`, `DetailPattern` or `FormPattern` from a file that definitely renders on the server |

Each rule has a case in `lint/test/` that catches, and one that lets correct
code through.

### Tables render on the server

A page in the App Router fetches its data in the server component, `Table` is
a client component — and React passes **no function** across that boundary.
That is why the server-capable form is the default:

```tsx
<Table
  caption="Entries"
  rows={items.map(toRow)}
  columns={[
    { field: 'title', header: 'Title' },
    { field: 'created', header: 'Created', hideBelow: 'sm' },
  ]}
  empty={{ title: 'No entries yet' }}
  error={failed ? { title: 'Not loaded' } : undefined}
/>
```

- A column names its `field`; the column key is then the field name.
- `rowKey` can be omitted as long as the row has an `id` field; otherwise the
  field name.
- Derived values (combined, formatted) are computed into the row by the server
  component beforehand instead of being put into a `cell` function.
- The table formats `null`, `''`, `Date`, `bigint` and `boolean` itself
  (`—`, `09/11/2026`, `Yes`/`No`) — without the browser's time zone and
  locale, otherwise something different would show after hydration.

`cell`, `rowKey` as a function, `onRowActivate`, `onSubmit` and `back.onClick`
remain allowed — but only in a file with `'use client'`. `DetailPattern` has
`back: { label, href }` for this. What the `no-server-function-props` rule
does not see: an extracted component without `'use client'` that a server page
uses, and functions that only a call returns (`columns={columns()}`).

### What counts as a form

`require-form-states` reports a file if it

- contains a `<form>` with at least one field, **or**
- contains two or more fields (`Input`, `Select`, `Checkbox`, `input`,
  `textarea`) together with a submit path (`onSubmit`/`onSave`/`onCreate`/
  `onUpdate` or a button with `type="submit"`),

and does not import `FormPattern` from `@openapps/ui`. A single search field
and a filter bar are therefore not a form.

Why the pattern import and not "has an error message": a rule that only checks
for an `error` prop can be tricked with an empty string. `FormPattern` brings
validation, `aria-invalid`, `aria-describedby`, `role="alert"` and the error
summary.

### Additional allowed packages (`allowed-packages.json`)

`no-foreign-ui` stays an allowlist. Packages that are not UI and that an app
still needs (`zod`, `date-fns`, …) are added by **the control plane** to a
JSON file in the root of the app repo:

```json
["zod", "date-fns", "@tanstack/react-query"]
```

or, with room for a comment:

```json
{ "_comment": "Maintained by the control plane.", "allow": ["zod"] }
```

- Default path: `allowed-packages.json`, relative to the ESLint root. It can
  be changed with the `allowExtraFile` option; `useAllowlistFile: false`
  disables reading it altogether.
- **If the file is missing, only the built-in allowlist applies — never "then
  allow everything".** The same goes for broken JSON or a wrong format: the
  rule reports the file error once and stays strict.
- UI libraries do not belong there. The interface comes from `@openapps/ui`,
  otherwise the product falls apart.

An empty example file with explanation is at
`lint/allowed-packages.example.json`.

## Development

```bash
pnpm --filter @openapps/ui test        # vitest + @testing-library/react
pnpm --filter @openapps/ui typecheck
pnpm --filter @openapps/ui lint        # the package checks itself with its own rules
pnpm --filter @openapps/ui showcase    # showcase at http://localhost:4321
```

The showcase (`showcase/`) shows all components, all five patterns and the
`PlatformShell` (theme in the account menu). States via the address:
`?platform=none`, `?apps=many`, `?user=loading`, `?sections=none`;
`?shell=app` shows the older `AppShell`.

## PlatformShell

The shared sidebar of every app (ADR 0017). The platform data comes from the
gateway; the app only passes its own sections:

```tsx
import { PlatformShell, themeScript } from '@openapps/ui';

// In <head>, so a stored theme applies before the first paint:
<script dangerouslySetInnerHTML={{ __html: themeScript }} />

<PlatformShell
  platform={navigation}          // from getNavigation() in @openapps/sdk, or null
  appName="crm"
  appTitle="CRM"
  sections={[{ items: [{ id: 'companies', label: 'Companies', href: '/crm/companies', current: true }] }]}
  user={user}                    // null = loading skeleton
>
  {children}
</PlatformShell>
```

`platform: null` shows only the current app and no platform links. Any href
that is not `http(s)://…` or `/…` is never rendered. Theme (`data-theme` on
`<html>`) and the collapsed rail are remembered in `localStorage`.

## Rules for app agents

1. No colour outside the tokens. Not even "just here, quickly".
2. Every list has an empty and an error state — easiest via `ListPattern`.
3. Every form uses `FormPattern` — the linter requires the import.
4. The shell comes from the platform. Apps build only their content and pass
   the user from `@openapps/sdk` in as the `user` prop. No login of their own.
5. Phone width without horizontal scrolling: containers `min-w-0`, long texts
   `truncate` or `[overflow-wrap:anywhere]`.
6. Do not write fixed text into a component that belongs in the design system
   — it comes from `strings`.
