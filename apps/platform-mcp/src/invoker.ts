/**
 * Die Weiterleitung an eine App liegt seit ADR 0020 in der Control Plane
 * (`infra/app-tool-invoker.ts`): Der MCP fuer Agents und die Route fuer
 * App-Aufrufe nutzen dieselbe. Was sie tut und warum der direkte Weg an den
 * Container nicht unsicherer ist, steht dort.
 */

export {
  appToolUrl,
  createHttpInvoker,
  type HttpInvokerOptions,
} from '@openapps/control-plane/infra/app-tool-invoker';
