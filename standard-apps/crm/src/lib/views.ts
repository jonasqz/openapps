import type { NextStepView } from '@/components/NextStepList';
import type { NextStep } from './crm';
import { formatDate } from './format';

/**
 * Aufbereitung fuer die Oberflaeche: fertige Texte statt Funktionen, damit
 * die Werte von der Server-Seite in Client-Komponenten duerfen.
 */

/**
 * Ein naechster Schritt fuer `NextStepList`. `on` ist die Seite, auf der die
 * Liste steht; deren Bezug wird nicht noch einmal verlinkt.
 */
export function nextStepView(step: NextStep, on: 'deal' | 'company' | 'contact' | 'overview'): NextStepView {
  let context: NextStepView['context'];
  if (on !== 'deal' && step.dealId !== null && step.dealTitle !== null) {
    context = { label: step.dealTitle, href: `/deals/${step.dealId}` };
  } else if (on !== 'contact' && step.contactId !== null && step.contactName !== null) {
    context = { label: step.contactName, href: `/contacts/${step.contactId}` };
  } else if (on !== 'company' && step.companyId !== null && step.companyName !== null) {
    context = { label: step.companyName, href: `/companies/${step.companyId}` };
  }
  return {
    id: step.id,
    title: step.title,
    dueLabel: formatDate(step.dueOn),
    overdue: step.overdue,
    done: step.doneAt !== null,
    owner: step.owner,
    ...(context === undefined ? {} : { context }),
  };
}
