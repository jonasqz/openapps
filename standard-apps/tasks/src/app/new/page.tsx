import { TaskForm } from '@/components/TaskForm';
import { TextLink } from '@/components/links';

export default function NewTaskPage() {
  return (
    <>
      <TextLink href="/" className="self-start text-sm">
        ← All tasks
      </TextLink>
      <TaskForm />
    </>
  );
}
