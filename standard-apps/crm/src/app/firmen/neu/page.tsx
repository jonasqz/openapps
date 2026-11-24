import { CompanyForm } from '@/components/forms/CompanyForm';
import { TextLink } from '@/components/links';

export default function NewCompanyPage() {
  return (
    <>
      <TextLink href="/firmen" className="self-start text-sm">
        ← Alle Firmen
      </TextLink>
      <CompanyForm />
    </>
  );
}
