import { parseArgs, type ToolHandler } from '@openapps/sdk';
import {
  createCompany,
  createContact,
  completeNextStep,
  createDeal,
  createNextStep,
  getCompany,
  getContact,
  getDeal,
  listActivities,
  listCompanies,
  listContacts,
  listDeals,
  listNextSteps,
  logActivity,
  pipelineSummary,
  reopenNextStep,
  updateContact,
  updateDeal,
  updateDealStage,
} from './crm';
import {
  ActivitiesListArgs,
  ActivityLogArgs,
  CompaniesListArgs,
  CompanyCreateArgs,
  ContactCreateArgs,
  ContactsListArgs,
  ContactUpdateArgs,
  DealCreateArgs,
  DealsListArgs,
  DealUpdateArgs,
  DealUpdateStageArgs,
  IdArgs,
  NextStepCompleteArgs,
  NextStepCreateArgs,
  NextStepsListArgs,
  PipelineSummaryArgs,
} from './schemas';

/**
 * Jedes Tool des CRM, genau einmal. Die Namen stehen gleich in app.json
 * (`offeredTools`) und als Pfad `/tools/<name>` in openapi.yaml; ein Test
 * haelt die drei Stellen deckungsgleich.
 *
 * Die UI ruft dieselben Handler (src/app/actions.ts) — es gibt keinen
 * zweiten Weg in die Daten, der an den Tools vorbeigeht.
 *
 * Jeder Handler prueft zuerst seine Argumente. Falsche Argumente erreichen
 * die Datenbank nie.
 */
export const toolHandlers = {
  'companies.list': async (args) => ({
    companies: await listCompanies(parseArgs(CompaniesListArgs, args)),
  }),
  'companies.get': async (args) => getCompany(parseArgs(IdArgs, args).id),
  'companies.create': async (args) => ({
    company: await createCompany(parseArgs(CompanyCreateArgs, args)),
  }),

  'contacts.list': async (args) => ({
    contacts: await listContacts(parseArgs(ContactsListArgs, args)),
  }),
  'contacts.get': async (args) => getContact(parseArgs(IdArgs, args).id),
  'contacts.create': async (args) => ({
    contact: await createContact(parseArgs(ContactCreateArgs, args)),
  }),
  'contacts.update': async (args) => ({
    contact: await updateContact(parseArgs(ContactUpdateArgs, args)),
  }),

  'deals.list': async (args) => ({ deals: await listDeals(parseArgs(DealsListArgs, args)) }),
  'deals.get': async (args) => getDeal(parseArgs(IdArgs, args).id),
  'deals.create': async (args, { user }) => ({
    deal: await createDeal(parseArgs(DealCreateArgs, args), user.id),
  }),
  'deals.update': async (args) => ({ deal: await updateDeal(parseArgs(DealUpdateArgs, args)) }),
  'deals.update_stage': async (args, { user }) =>
    updateDealStage(parseArgs(DealUpdateStageArgs, args), user.id),

  'next_steps.list': async (args) => ({
    nextSteps: await listNextSteps(parseArgs(NextStepsListArgs, args)),
  }),
  'next_steps.create': async (args, { user }) => ({
    nextStep: await createNextStep(parseArgs(NextStepCreateArgs, args), user.id),
  }),
  'next_steps.complete': async (args, { user }) =>
    completeNextStep(parseArgs(NextStepCompleteArgs, args), user.id),
  'next_steps.reopen': async (args, { user }) => reopenNextStep(parseArgs(IdArgs, args).id, user.id),

  'activities.log': async (args, { user }) => ({
    activity: await logActivity(parseArgs(ActivityLogArgs, args), user.id),
  }),
  'activities.list': async (args) => ({
    activities: await listActivities(parseArgs(ActivitiesListArgs, args)),
  }),

  'pipeline.summary': async (args) => {
    parseArgs(PipelineSummaryArgs, args);
    return pipelineSummary();
  },
} satisfies Record<string, ToolHandler>;

export type ToolName = keyof typeof toolHandlers;

export const TOOL_NAMES = Object.keys(toolHandlers) as ToolName[];
