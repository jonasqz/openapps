/**
 * @openapps/ui — Design System von openapps.
 *
 * Eine App importiert ausschließlich hier (oder aus `@openapps/ui/tokens`).
 * Der UI-Linter blockiert jede andere UI-Bibliothek und jeden eigenen Farbwert.
 */
export * from './components/index.ts';
export * from './shell/index.ts';

/* Muster. `EmptyState`/`ErrorState` kommen schon aus den Komponenten. */
export { ListPattern } from './patterns/ListPattern.tsx';
export type { ListFilter, ListPatternProps } from './patterns/ListPattern.tsx';
export { FormPattern } from './patterns/FormPattern.tsx';
export type {
  CheckboxFormField,
  FormField,
  FormFieldBase,
  FormPatternProps,
  FormValues,
  SelectFormField,
  TextFormField,
} from './patterns/FormPattern.tsx';
export { DetailPattern } from './patterns/DetailPattern.tsx';
export type {
  DetailBack,
  DetailField,
  DetailPatternProps,
  DetailSection,
} from './patterns/DetailPattern.tsx';

/* Texte. v1 ist deutsch; eine App kann einzelne Texte ersetzen. */
export { germanStrings, overrideStrings, resetStrings, strings } from './strings.ts';
export type { StringsOverride, UiStrings } from './strings.ts';

export { cn } from './lib/cn.ts';
export type { ClassValue } from './lib/cn.ts';
export { focusRing, focusRingInset } from './lib/focus.ts';
export { useFieldIds } from './lib/useId.ts';
