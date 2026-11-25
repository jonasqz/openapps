import { AddDocumentForm } from '@/components/AddDocumentForm';

/** Formular „Add document“. Die Mutation ist das Tool `documents.add`. */
export default function NewDocumentPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <AddDocumentForm />
    </div>
  );
}
