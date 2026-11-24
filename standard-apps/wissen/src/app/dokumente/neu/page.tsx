import { AddDocumentForm } from '@/components/AddDocumentForm';

/** Formular „Dokument hinzufügen“. Die Mutation ist das Tool `documents.add`. */
export default function NewDocumentPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 p-4 sm:p-6">
      <AddDocumentForm />
    </main>
  );
}
