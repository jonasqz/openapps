import type { TaskRowData } from '@/components/TaskTable';
import type { Task } from './tasks';

/** Nur die Felder, die die Tabelle braucht, ueber die Server/Client-Grenze. */
export const toRowData = (task: Task): TaskRowData => ({
  id: task.id,
  title: task.title,
  status: task.status,
  priority: task.priority,
  assignee: task.assignee,
  dueDate: task.dueDate,
  overdue: task.overdue,
  projectName: task.projectName,
});
