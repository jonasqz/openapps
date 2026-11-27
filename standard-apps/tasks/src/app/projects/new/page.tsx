import { TextLink } from '@/components/links';
import { ProjectForm } from '@/components/ProjectForm';

export default function NewProjectPage() {
  return (
    <>
      <TextLink href="/projects" className="self-start text-sm">
        ← Projects
      </TextLink>
      <ProjectForm />
    </>
  );
}
