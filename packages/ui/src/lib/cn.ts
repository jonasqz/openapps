/**
 * Klassen zusammenfügen. Absichtlich winzig und ohne Abhängigkeit:
 * `clsx`/`tailwind-merge` wären eine fremde Bibliothek mehr im Baum.
 *
 * Letzte Klasse gewinnt nicht automatisch — Komponenten setzen ihre Basis
 * zuerst, `className` des Aufrufers danach.
 */
export type ClassValue = string | number | false | null | undefined | ClassValue[];

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    out.push(String(value));
  };
  for (const value of values) walk(value);
  return out.join(' ');
}
