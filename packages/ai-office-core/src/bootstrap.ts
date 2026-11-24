/**
 * bootstrap: arranque en frío de la oficina.
 *
 * ## El problema (siempre que /oficina "no funcionaba")
 *
 * En un root nuevo (corrida de cero), el roster viene vacío: ningún agente
 * tiene `canDelegate`. `oficina_dispatch` requiere una llamada de un agente
 * del roster con `canDelegate` — como no existe quien cumpla, TODAS las
 * llamadas son rechazadas y la sesión cae al protocolo en fallback
 * (subagentes genéricos sin motor). En cada sesión nueva, el síntoma.
 *
 * ## Solución determinística, no un bypass
 *
 * En frío (sin ningún agente con canDelegate en el roster) + sesión de host
 * confiable (build|general|plan|oficina-*) => se auto-despliega una ficha de
 * Comandante builtin, con el mismo id de la sesión (p.ej. "build"), con
 * `canDelegate: true`. A partir de ahí, la identidad de sesión existente
 * (ya validada por ctx.agent) sirve para llamar al motor.
 *
 * Sesión NO confiable (agents inventados en tests) => nada cambia: el motor
 * sigue rechazando y la sesión debe desplegar un Comandante a mano.
 */
import type { Ficha } from "./types.js";
import type { Office } from "./office.js";
import type { Roster } from "./types.js";

const TRUSTED_HOST_AGENTS = new Set([
  "build",
  "general",
  "plan",
  "oficina-commander",
  "oficina-architect",
  "oficina-integrator",
]);

export interface BootstrapResult {
  /** true si se auto-desplegó un Comandante builtin en esta llamada. */
  deployed: boolean;
  /** id de la ficha desplegada (ctx.agent), si aplica. */
  agentId?: string;
}

/** ¿Hay al menos un agente con autoridad de despacho? */
export function hasDelegator(roster: Roster): boolean {
  return Object.values(roster.agents).some((a) => a.canDelegate && a.state !== "retired");
}

/** Comandante builtin determinista, mismo id que la sesión del host. */
export function createBuiltinFicha(agentId: string): Ficha {
  return {
    id: agentId,
    role: "commander",
    displayName: `Integrator (builtin, ${agentId})`,
    source: { kind: "factory", template: "bootstrap/integrator" } as Ficha["source"],
    capabilities: ["coordination", "delegation", "routing", "synthesis"],
    tools: ["read", "glob", "grep", "edit", "write", "bash", "task"],
    scope: { mayTouch: ["**"], forbidden: ["**/*.env", "**/.env", "**/.oficina/**"] },
    canDelegate: true,
    delegateBudget: 3,
    peers: [],
    mustNot: [
      "no editar .oficina/",
      "no tocar .env",
      "no aprobar trabajo propio",
    ],
    onFinish: "idle-join",
    escalateTo: "integrator",
  };
}

/**
 * Si el roster está vacío y la sesión es host confiable, despliega un
 * Comandante builtin. Idempotente: si ya existe un delegator, no hace nada.
 */
export async function bootstrapIntegratorIfNeeded(
  office: Office,
  ctxAgentId: string | undefined,
): Promise<BootstrapResult> {
  if (!ctxAgentId || !TRUSTED_HOST_AGENTS.has(ctxAgentId)) {
    return { deployed: false };
  }
  const state = await office
    .loadState()
    .catch(() => undefined);
  if (!state) return { deployed: false };
  const roster = await office.loadRoster(state.runId);
  if (hasDelegator(roster)) return { deployed: false };
  const ficha = createBuiltinFicha(ctxAgentId);
  await office.deploy(ficha);
  return { deployed: true, agentId: ctxAgentId };
}
