import { AufgabeForm } from '@/components/AufgabeForm';
import { TextLink } from '@/components/links';

export default function NeueAufgabePage() {
  return (
    <>
      <TextLink href="/" className="self-start text-sm">
        ← Alle Aufgaben
      </TextLink>
      <AufgabeForm />
    </>
  );
}
