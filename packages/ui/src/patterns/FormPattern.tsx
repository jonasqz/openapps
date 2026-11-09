import { useCallback, useId, useRef, useState } from 'react';
import type { FormEvent, JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { Button } from '../components/Button.tsx';
import { Checkbox } from '../components/Checkbox.tsx';
import { Input } from '../components/Input.tsx';
import { Select } from '../components/Select.tsx';
import type { SelectOption } from '../components/Select.tsx';
import { strings } from '../strings.ts';

export type FormValues = Record<string, string | boolean>;

export interface FormFieldBase {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** Prüft einen Wert. Rückgabe `undefined` heißt gültig. */
  validate?: (value: string | boolean, values: FormValues) => string | undefined;
}

export interface TextFormField extends FormFieldBase {
  kind: 'text' | 'email' | 'number' | 'password' | 'search';
  placeholder?: string;
}

export interface SelectFormField extends FormFieldBase {
  kind: 'select';
  options: readonly SelectOption[];
  placeholder?: string;
}

export interface CheckboxFormField extends FormFieldBase {
  kind: 'checkbox';
}

export type FormField = TextFormField | SelectFormField | CheckboxFormField;

export interface FormPatternProps {
  title: string;
  description?: string;
  fields: readonly FormField[];
  initialValues?: FormValues;
  submitLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  /**
   * Speichern. Ein zurückgegebenes Objekt sind Feldfehler vom Server —
   * sie landen sichtbar am jeweiligen Feld.
   */
  onSubmit: (values: FormValues) => Promise<Record<string, string> | void> | Record<string, string> | void;
  /** Fehler, der kein einzelnes Feld betrifft (z. B. Netzwerk). */
  formError?: string;
  /** Zwei Spalten ab `sm`. Auf Phone-Breite immer einspaltig. */
  columns?: 1 | 2;
  children?: ReactNode;
  className?: string;
}

/** Eingebaute Prüfungen, damit jedes Formular mindestens Pflichtfelder prüft. */
function builtinValidate(field: FormField, value: string | boolean): string | undefined {
  if (field.required === true) {
    if (field.kind === 'checkbox' && value !== true) return strings.form.confirmRequired;
    if (field.kind !== 'checkbox' && String(value).trim() === '') return strings.form.required;
  }
  if (field.kind === 'email' && typeof value === 'string' && value.trim() !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return strings.form.invalidEmail;
  }
  if (field.kind === 'number' && typeof value === 'string' && value.trim() !== '') {
    if (Number.isNaN(Number(value))) return strings.form.invalidNumber;
  }
  return undefined;
}

/**
 * Muster „Formular“.
 *
 * Validierung läuft beim Verlassen des Feldes und beim Absenden. Jeder Fehler
 * steht sichtbar unter seinem Feld (`role="alert"`, `aria-invalid`,
 * `aria-describedby`), zusätzlich gibt es eine Zusammenfassung oben mit
 * Sprungmarken — so findet man den Fehler auch in einem langen Formular.
 */
export function FormPattern({
  title,
  description,
  fields,
  initialValues = {},
  submitLabel,
  cancelLabel,
  onCancel,
  onSubmit,
  formError,
  columns = 1,
  children,
  className,
}: FormPatternProps): JSX.Element {
  const baseId = useId().replace(/:/g, '');
  const summaryRef = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<FormValues>(() => {
    const start: FormValues = {};
    for (const field of fields) {
      start[field.name] = initialValues[field.name] ?? (field.kind === 'checkbox' ? false : '');
    }
    return start;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const fieldId = (name: string): string => `${baseId}-${name}`;

  const validateField = useCallback(
    (field: FormField, value: string | boolean, all: FormValues): string | undefined =>
      builtinValidate(field, value) ?? field.validate?.(value, all),
    [],
  );

  const setValue = (field: FormField, value: string | boolean): void => {
    const next = { ...values, [field.name]: value };
    setValues(next);
    if (touched[field.name] === true) {
      const message = validateField(field, value, next);
      setErrors((current) => {
        const copy = { ...current };
        if (message === undefined) delete copy[field.name];
        else copy[field.name] = message;
        return copy;
      });
    }
  };

  const blurField = (field: FormField): void => {
    setTouched((current) => ({ ...current, [field.name]: true }));
    const message = validateField(field, values[field.name] ?? '', values);
    setErrors((current) => {
      const copy = { ...current };
      if (message === undefined) delete copy[field.name];
      else copy[field.name] = message;
      return copy;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found: Record<string, string> = {};
    for (const field of fields) {
      const message = validateField(field, values[field.name] ?? '', values);
      if (message !== undefined) found[field.name] = message;
    }
    setTouched(Object.fromEntries(fields.map((field) => [field.name, true])));
    setErrors(found);
    if (Object.keys(found).length > 0) {
      summaryRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const serverErrors = await onSubmit(values);
      if (serverErrors !== undefined && serverErrors !== null && Object.keys(serverErrors).length > 0) {
        setErrors(serverErrors);
        summaryRef.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const errorList = fields
    .filter((field) => errors[field.name] !== undefined)
    .map((field) => ({ name: field.name, label: field.label, message: errors[field.name]! }));

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(event)}
      className={cn('flex min-w-0 flex-col gap-5', className)}
      aria-labelledby={`${baseId}-title`}
    >
      <div className="min-w-0">
        <h1 id={`${baseId}-title`} className="text-2xl font-semibold text-fg [overflow-wrap:anywhere]">
          {title}
        </h1>
        {description === undefined ? null : (
          <p className="mt-1 text-sm text-fg-muted [overflow-wrap:anywhere]">{description}</p>
        )}
      </div>

      {errorList.length > 0 || formError !== undefined ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-danger bg-danger-subtle p-3 text-danger-subtle-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <p className="text-sm font-semibold">
            {formError ?? strings.form.summary(errorList.length)}
          </p>
          {errorList.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-sm">
              {errorList.map((item) => (
                <li key={item.name}>
                  <a href={`#${fieldId(item.name)}`} className="underline underline-offset-2">
                    {item.label}
                  </a>
                  {`: ${item.message}`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className={cn('grid min-w-0 gap-4', columns === 2 && 'sm:grid-cols-2')}>
        {fields.map((field) => {
          const error = errors[field.name];
          const shared = {
            id: fieldId(field.name),
            label: field.label,
            onBlur: () => blurField(field),
            ...(field.hint === undefined ? {} : { hint: field.hint }),
            ...(error === undefined ? {} : { error }),
            ...(field.required === undefined ? {} : { required: field.required }),
          };
          if (field.kind === 'checkbox') {
            return (
              <Checkbox
                key={field.name}
                {...shared}
                checked={values[field.name] === true}
                onChange={(event) => setValue(field, event.target.checked)}
              />
            );
          }
          if (field.kind === 'select') {
            return (
              <Select
                key={field.name}
                {...shared}
                options={field.options}
                value={String(values[field.name] ?? '')}
                onChange={(event) => setValue(field, event.target.value)}
                {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
              />
            );
          }
          return (
            <Input
              key={field.name}
              {...shared}
              type={field.kind}
              value={String(values[field.name] ?? '')}
              onChange={(event) => setValue(field, event.target.value)}
              {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
            />
          );
        })}
      </div>

      {children}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel === undefined ? null : (
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            {cancelLabel ?? strings.form.cancel}
          </Button>
        )}
        <Button type="submit" loading={submitting} loadingLabel={strings.form.submitting}>
          {submitLabel ?? strings.form.submit}
        </Button>
      </div>
    </form>
  );
}
