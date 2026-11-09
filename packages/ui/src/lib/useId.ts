import { useId as reactUseId } from 'react';

/** Stabile IDs für `aria-describedby`, Labels und Fehlermeldungen. */
export function useFieldIds(explicitId?: string): {
  inputId: string;
  labelId: string;
  hintId: string;
  errorId: string;
} {
  const generated = reactUseId();
  const base = explicitId ?? `oa-${generated.replace(/:/g, '')}`;
  return {
    inputId: base,
    labelId: `${base}-label`,
    hintId: `${base}-hint`,
    errorId: `${base}-error`,
  };
}
