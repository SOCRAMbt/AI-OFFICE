/*
 * Tests del modelo del panel del jefe (T-06).
 *
 * Correr:  node --test dashboard/tests/
 * El modelo es un script clasico con side-effect: se lo importa y queda en
 * globalThis.OficinaLeadership (mismo objeto que usa leadership.html).
 */
import test from "node:test";
import assert from "node:assert/strict";

import "../lib/leadership-model.js";

const L = globalThis.OficinaLeadership;

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-10-29T18:00:00.000Z");

function snapshot(overrides = {}) {
  const base = {
    generatedAt: new Date(NOW).toISOString(),
    source: "test",
    state: {
      runId: "run-test",
      status: "running",
      cards: {
        "T-06": {
          id: "T-06",
          title: "Panel de intervencion del jefe",
          state: "in_progress",
          owner: "e-xr-immersive-developer",
          reviewer: "e-testing-api-tester",
          acceptance: ["Tres secciones", "Filtros"],
          gate: "leadership.html funcional",
        },
        "T-00": { id: "T-00", title: "Guard", state: "done", owner: "e-testing-api-tester" },
        "T-07": { id: "T-07", title: "Kanban", state: "rework", owner: "e-xr-immersive-developer" },
      },
      decisions: [
        { at: "2026-10-29T17:39:09.101Z", cardId: "T-06", decision: "approved", reason: "routing: sin agente disponible", actor: "integrator" },
        { at: "2026-10-29T16:00:00.000Z", cardId: "T-07", decision: "rework", reason: "distancia de similitud 0.42, bajo el umbral", actor: "oficina-critico" },
        { at: "2026-10-29T15:00:00.000Z", cardId: "T-07", decision: "replan", reason: "el contrato de datos no cierra con el schema actual", actor: "oficina-director" },
        { at: "2026-10-29T14:00:00.000Z", cardId: "T-00", decision: "spawn_rejected", reason: "no hace falta agente nuevo: factory ya cubre", actor: "oficina-director" },
      ],
      escalations: [
        {
          id: "esc-1",
          cardId: "T-07",
          at: "2026-10-29T13:00:00.000Z",
          cause: "deadlock entre lease de T-07 y T-06",
          options: [{ id: "o1", label: "Liberar lease", tradeoff: "pierde progreso" }],
          recommendation: "liberar",
          status: "open",
        },
        { id: "esc-0", cardId: "T-06", at: "2026-10-29T12:00:00.000Z", cause: "ya resuelta", options: [], recommendation: "", status: "resolved" },
      ],
      context: { decisions: ["HTML + CSS + JS vanilla sin build step", "T-06 consume snapshot unico"] },
    },
    roster: {
      agents: {
        "e-xr-immersive-developer": { id: "e-xr-immersive-developer", displayName: "XR Immersive Developer" },
        "e-testing-api-tester": { id: "e-testing-api-tester", displayName: "API Tester" },
      },
    },
    messages: [
      {
        channel: "coord-arch",
        message: {
          id: "m-arch-1", seq: 1, from: "architect", to: ["*"], kind: "NOTICE",
          subject: "Contrato de snapshot",
          body: { type: "contract", reason: "un endpoint evita lecturas rasgadas", text: "snapshot { state, roster, messages }" },
          createdAt: "2026-10-29T17:00:00.000Z", priority: "high",
        },
      },
      {
        channel: "coord-flow",
        message: {
          id: "m-flow-1", seq: 2, from: "integrator", to: ["e-testing-api-tester"], kind: "NOTICE",
          subject: "T-06 despachada",
          body: { card: "T-06", reason: "owner asignado, lease activo por 900s" },
          createdAt: "2026-10-29T17:10:00.000Z", priority: "normal",
        },
      },
      {
        channel: "peer",
        message: {
          id: "m-peer-1", seq: 3, from: "e-testing-api-tester", to: ["*"], kind: "STATUS",
          subject: "T-00 entregada", body: { card: "T-00" },
          createdAt: "2026-10-29T17:20:00.000Z", priority: "normal",
        },
      },
    ],
    artifacts: { "T-06": { dir: "../.oficina/artifacts/T-06/", files: ["handoff.md", "evidence.md"] } },
  };
  return { ...base, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// Clasificacion por coordinador
// ─────────────────────────────────────────────────────────────────────────────

test("routing de state.json cae en Integrator", () => {
  const cls = L.classifyDecision({ decision: "approved", reason: "routing: sin agente disponible", actor: "integrator" });
  assert.equal(cls.coordinator, "integrator");
  assert.equal(cls.type, "routing");
});

test("escalated cae en Commander aunque el texto hable de gates", () => {
  const cls = L.classifyDecision({ decision: "escalated", reason: "el gate de seguridad no cierra", actor: "e-testing-api-tester" });
  assert.equal(cls.coordinator, "commander");
  assert.equal(cls.type, "escalation");
});

test("rework por rechazo de review cae en Integrator/gate", () => {
  const cls = L.classifyDecision({ decision: "rework", reason: "1 de 3 rechazos", actor: "oficina-critico" });
  assert.equal(cls.coordinator, "integrator");
  assert.equal(cls.type, "gate");
});

test("replan cae en Architect (cambia el enfoque tecnico)", () => {
  const cls = L.classifyDecision({ decision: "replan", reason: "", actor: "oficina-director" });
  assert.equal(cls.coordinator, "architect");
});

test("spawn_approved / spawn_rejected caen en Integrator/spawn", () => {
  for (const decision of ["spawn_approved", "spawn_rejected"]) {
    const cls = L.classifyDecision({ decision, reason: "factory", actor: "oficina-director" });
    assert.equal(cls.coordinator, "integrator", decision);
    assert.equal(cls.type, "spawn", decision);
  }
});

test("deadlock se clasifica aunque el actor sea el director", () => {
  const cls = L.classifyDecision({ decision: "approved", reason: "deadlock: dos leases sobre la misma card", actor: "oficina-director" });
  assert.equal(cls.type, "deadlock");
  assert.equal(cls.coordinator, "integrator");
});

test("classifyActor reconoce los tres coordinadores", () => {
  assert.equal(L.classifyActor("oficina-director"), "commander");
  assert.equal(L.classifyActor("commander"), "commander");
  assert.equal(L.classifyActor("integrator"), "integrator");
  assert.equal(L.classifyActor("oficina-architect"), "architect");
  assert.equal(L.classifyActor("e-testing-api-tester"), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Extraccion: las tres secciones
// ─────────────────────────────────────────────────────────────────────────────

test("extractDecisions produce las tres secciones con contenido", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  assert.deepEqual(Object.keys(res.sections).sort(), ["architect", "commander", "integrator"]);
  for (const id of ["commander", "integrator", "architect"]) {
    assert.ok(res.sections[id].length > 0, `${id} deberia tener decisiones`);
    for (const item of res.sections[id]) assert.equal(item.coordinator, id);
  }
  assert.equal(res.counts.total, res.items.length);
  assert.equal(res.counts.commander + res.counts.integrator + res.counts.architect, res.counts.total);
});

test("cada decision trae los seis campos exigidos y no quedan vacios", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  assert.ok(res.items.length >= 9);
  for (const item of res.items) {
    assert.ok(isFinite(Date.parse(item.at)), "timestamp valido: " + item.id);
    assert.ok(item.actorId && item.actorId.length, "actor: " + item.id);
    assert.ok(item.cardId === null || typeof item.cardId === "string", "cardId: " + item.id);
    assert.ok(typeof item.decision === "string" && item.decision.length, "decision: " + item.id);
    assert.ok(typeof item.reason === "string" && item.reason.length, "razon: " + item.id);
    assert.ok(typeof item.nextAction === "string" && item.nextAction.length, "siguiente accion: " + item.id);
    assert.ok(typeof item.typeLabel === "string" && item.typeLabel.length, "tipo: " + item.id);
  }
});

test("ordena de mas reciente a mas viejo", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  for (let i = 1; i < res.items.length; i++) {
    assert.ok(Date.parse(res.items[i - 1].at) >= Date.parse(res.items[i].at));
  }
});

test("lee mensajes de los tres canales de coordinadores y descarta peer", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const channels = new Set(res.items.filter((i) => i.source === "bus").map((i) => i.channel));
  assert.deepEqual([...channels].sort(), ["coord-arch", "coord-flow"]);
  assert.ok(!res.items.some((i) => i.id === "msg:m-peer-1"));
});

test("incluye peer solo si se pide explicitamente", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW, includePeer: true });
  assert.ok(res.items.some((i) => i.id === "msg:m-peer-1"));
});

test("un mensaje de coord-arch sin tipo explicito cae en Architect", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const archMsg = res.items.find((i) => i.id === "msg:m-arch-1");
  assert.ok(archMsg);
  assert.equal(archMsg.coordinator, "architect");
  assert.equal(archMsg.type, "contract");
  assert.equal(archMsg.cardId, null);
});

test("infiere cardId desde el cuerpo y desde el asunto", () => {
  assert.equal(L.inferCardId({ subject: "T-06 despachada", body: {} }), "T-06");
  assert.equal(L.inferCardId({ subject: "nada", body: { card: "T-07" } }), "T-07");
  assert.equal(L.inferCardId({ subject: "sin card", body: {} }), null);
});

test("las escalations abiertas van a Commander y las resueltas se omiten", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const escs = res.items.filter((i) => i.source === "escalation");
  assert.equal(escs.length, 1);
  assert.equal(escs[0].cardId, "T-07");
  assert.equal(escs[0].coordinator, "commander");
  assert.match(escs[0].nextAction, /usuario/);
});

test("el ledger context.decisions alimenta Architect como tech decisions", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const ctxItems = res.items.filter((i) => i.source === "context");
  assert.equal(ctxItems.length, 2);
  for (const item of ctxItems) {
    assert.equal(item.coordinator, "architect");
    assert.equal(item.type, "tech_decision");
  }
});

test("no rompe con snapshot vacio", () => {
  const res = L.extractDecisions({}, { now: NOW });
  assert.equal(res.items.length, 0);
  assert.deepEqual(res.counts, { total: 0, commander: 0, integrator: 0, architect: 0 });
  assert.deepEqual(res.sections, { commander: [], integrator: [], architect: [] });
});

test("no rompe con entradas malformadas", () => {
  const res = L.extractDecisions({
    state: { decisions: [null, 42, { at: "no-es-fecha", decision: "approved" }], escalations: [null], context: { decisions: [null] } },
    messages: [null, { channel: "coord-flow" }, { channel: "coord-flow", message: { id: "x" } }],
  }, { now: NOW });
  assert.ok(Array.isArray(res.items));
  for (const item of res.items) assert.ok(item.nextAction.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Siguiente accion
// ─────────────────────────────────────────────────────────────────────────────

test("routing sobre card todo manda a esperar claim del owner", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const routing = res.items.find((i) => i.type === "routing" && i.cardId === "T-06");
  assert.ok(routing);
  assert.match(routing.nextAction, /claim/i);
});

test("escalation manda a decidir el usuario", () => {
  assert.match(L.deriveNextAction({ type: "escalation", raw: "escalated" }, null), /usuario/i);
});

test("gate sobre card en rework manda al owner a rehacer", () => {
  const action = L.deriveNextAction({ type: "gate", raw: "rework" }, { state: "rework", owner: "e-x" });
  assert.match(action, /rehace/i);
  assert.match(action, /e-x/);
});

test("deadlock manda a liberar lease y reasignar", () => {
  assert.match(L.deriveNextAction({ type: "deadlock", raw: "approved" }, null), /lease/i);
});

test("approved sobre card done no pide accion", () => {
  assert.match(L.deriveNextAction({ type: "routing", raw: "approved" }, { state: "done" }), /Nada/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Filtros
// ─────────────────────────────────────────────────────────────────────────────

test("filtra por coordinador", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const only = L.filterDecisions(res.items, { coordinator: "architect" });
  assert.ok(only.length > 0);
  for (const item of only) assert.equal(item.coordinator, "architect");
});

test("filtra por card", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const only = L.filterDecisions(res.items, { card: "T-07" });
  assert.ok(only.length >= 2);
  for (const item of only) assert.equal(item.cardId, "T-07");
});

test("filtra por tipo de decision", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const only = L.filterDecisions(res.items, { type: "gate" });
  assert.ok(only.length > 0);
  for (const item of only) assert.equal(item.type, "gate");
});

test("filtra por texto libre (razon y accion)", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  assert.ok(L.filterDecisions(res.items, { query: "lease" }).length > 0);
  assert.ok(L.filterDecisions(res.items, { query: "routing" }).length > 0);
  assert.equal(L.filterDecisions(res.items, { query: "zzz-no-existe" }).length, 0);
});

test("los filtros se combinan", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const only = L.filterDecisions(res.items, { coordinator: "integrator", card: "T-07" });
  for (const item of only) {
    assert.equal(item.coordinator, "integrator");
    assert.equal(item.cardId, "T-07");
  }
});

test("filterOptions lista cards y tipos presentes", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const opts = L.filterOptions(res.items);
  assert.deepEqual(opts.cards.map((c) => c.id), ["T-00", "T-06", "T-07"]);
  const typeIds = opts.types.map((t) => t.id);
  assert.ok(typeIds.includes("routing"));
  assert.ok(typeIds.includes("contract"));
  assert.ok(typeIds.includes("escalation"));
  for (const t of opts.types) assert.ok(L.COORDINATOR_IDS.includes(t.coordinator));
});

test("groupByCoordinator siempre devuelve las tres claves", () => {
  const g = L.groupByCoordinator(L.filterDecisions([], {}));
  assert.deepEqual(Object.keys(g).sort(), ["architect", "commander", "integrator"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Links a card y artifacts
// ─────────────────────────────────────────────────────────────────────────────

test("cardLinks apunta a la card afectada y a sus artifacts", () => {
  const links = L.cardLinks("T-06");
  assert.equal(links.card, "#card-T-06");
  assert.match(links.kanban, /kanban\.html#T-06$/);
  assert.equal(links.artifacts, "../.oficina/artifacts/T-06/");
  assert.equal(links.handoff, "../.oficina/artifacts/T-06/handoff.md");
  assert.equal(links.evidence, "../.oficina/artifacts/T-06/evidence.md");
  assert.equal(links.gates, "../.oficina/artifacts/T-06/gates.md");
});

test("cardLinks devuelve nulls cuando no hay card", () => {
  const links = L.cardLinks(null);
  for (const k of Object.keys(links)) assert.equal(links[k], null, k);
});

test("las decisiones sin card no inventan links", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const archMsg = res.items.find((i) => i.id === "msg:m-arch-1");
  assert.equal(archMsg.links.card, null);
  assert.equal(archMsg.links.artifacts, null);
});

test("las decisiones con card enlazan artifacts reales", () => {
  const res = L.extractDecisions(snapshot(), { now: NOW });
  const t06 = res.items.filter((i) => i.cardId === "T-06");
  assert.ok(t06.length > 0);
  for (const item of t06) assert.equal(item.links.artifacts, "../.oficina/artifacts/T-06/");
});

// ─────────────────────────────────────────────────────────────────────────────
// Tiempo
// ─────────────────────────────────────────────────────────────────────────────

test("formatRelative cubre los rangos basicos", () => {
  const base = "2026-10-29T18:00:00.000Z";
  assert.equal(L.formatRelative(base, NOW), "ahora");
  assert.equal(L.formatRelative("2026-10-29T17:59:30.000Z", NOW), "hace 30s");
  assert.equal(L.formatRelative("2026-10-29T17:55:00.000Z", NOW), "hace 5m");
  assert.equal(L.formatRelative("2026-10-29T15:00:00.000Z", NOW), "hace 3h");
  assert.equal(L.formatRelative("2026-10-27T18:00:00.000Z", NOW), "hace 2d");
  assert.equal(L.formatRelative("basura", NOW), "—");
});

test("formatClock devuelve HH:MM:SS o —", () => {
  assert.match(L.formatClock("2026-10-29T18:04:09.000Z"), /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(L.formatClock("nope"), "—");
});

// ─────────────────────────────────────────────────────────────────────────────
// Demo
// ─────────────────────────────────────────────────────────────────────────────

test("el snapshot demo produce las tres secciones pobladas", () => {
  const res = L.extractDecisions(L.demoSnapshot(NOW), { now: NOW });
  for (const id of ["commander", "integrator", "architect"]) {
    assert.ok(res.sections[id].length > 0, `demo sin decisiones en ${id}`);
  }
});

test("la API publica expone todo lo que el panel necesita", () => {
  for (const key of [
    "COORDINATORS", "classifyDecision", "deriveNextAction", "extractDecisions",
    "filterDecisions", "filterOptions", "cardLinks", "formatRelative", "demoSnapshot",
  ]) {
    assert.ok(L[key], "falta " + key);
  }
  assert.equal(L.COORDINATORS.length, 3);
});
