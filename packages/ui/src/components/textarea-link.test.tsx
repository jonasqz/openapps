import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Textarea } from './Textarea.tsx';
import { DetailPattern } from '../patterns/DetailPattern.tsx';
import { LinkProvider } from '../lib/link.tsx';

describe('Textarea', () => {
  it('haengt Label, Hilfe und Fehler zugaenglich an', () => {
    render(<Textarea label="Inhalt" hint="Markdown geht" error="Darf nicht leer sein" />);
    const field = screen.getByLabelText('Inhalt');
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(/Markdown geht.*Darf nicht leer sein/);
  });

  it('setzt Festbreite nur auf Wunsch', () => {
    render(<Textarea label="Code" monospace />);
    expect(screen.getByLabelText('Code').className).toMatch(/font-mono/);
  });
});

describe('Back-Link im DetailPattern', () => {
  const sections = [{ title: 'A', fields: [{ label: 'x', value: 'y' }] }];

  it('ist ohne Provider ein schlichter Anker', () => {
    render(
      <DetailPattern title="T" sections={sections} back={{ label: 'Back', href: '/companies' }} />,
    );
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute('href', '/companies');
  });

  it('nimmt den Link der App, damit der Pfad der App stimmt', () => {
    const AppLink = ({
      href,
      className,
      children,
    }: {
      href: string;
      className?: string;
      children?: ReactNode;
    }) => (
      <a href={`/crm${href}`} className={className} data-app-link="">
        {children}
      </a>
    );
    render(
      <LinkProvider component={AppLink}>
        <DetailPattern title="T" sections={sections} back={{ label: 'Back', href: '/companies' }} />
      </LinkProvider>,
    );
    const link = screen.getByRole('link', { name: /Back/ });
    expect(link).toHaveAttribute('href', '/crm/companies');
    expect(link).toHaveAttribute('data-app-link');
  });
});
