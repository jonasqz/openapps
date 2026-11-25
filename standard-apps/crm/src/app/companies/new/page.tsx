import { CompanyForm } from '@/components/forms/CompanyForm';
import { TextLink } from '@/components/links';

export default function NewCompanyPage() {
  return (
    <>
      <TextLink href="/companies" className="self-start text-sm">
        ← All companies
      </TextLink>
      <CompanyForm />
    </>
  );
}
