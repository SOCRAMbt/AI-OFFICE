/*
 * debate-demo.js — snapshot sintético para ver el panel cuando no hay server
 * ni acceso a .oficina/ (file://). Se rotula como DEMO en la UI: no son datos
 * reales de la corrida. Incluye dos mensajes de ruido (un HELP_REQUEST a un
 * solo agente y un STATUS broadcast) que el panel debe ignorar.
 */
(function (root) {
  "use strict";

  function iso(secondsAgo) {
    return new Date(Date.now() - secondsAgo * 1000).toISOString();
  }

  var now = Date.now();

  var messages = [
    {
      id: "demo-r1", seq: 1, from: "e-mesa-visual", to: ["*"], kind: "HELP_REQUEST", subject: "T-03",
      body: { need: "El panel de mesa no pinta el estado 'no-heartbeat' cuando el agente no latió nunca.", why_me: "mi card no toca la lógica de heartbeat, es de src/core" },
      replyTo: null, inReplyTo: null, ttlSec: 900, createdAt: iso(240), priority: "normal", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-r2", seq: 2, from: "e-bus-threading", to: ["*"], kind: "HELP_REQUEST", subject: "T-04",
      body: { need: "Necesito decidir si los hilos se agrupan por inReplyTo o por subject cuando el padre venció por TTL.", why_me: "es una decisión de contrato de datos, no de mi UI" },
      replyTo: null, inReplyTo: null, ttlSec: 900, createdAt: iso(150), priority: "high", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-a1", seq: 3, from: "e-testing-api-tester", to: ["e-mesa-visual"], kind: "HELP_ACCEPT", subject: "T-03",
      body: { answer: "Mirá src/core/heartbeat.ts: el estado null se mapea a 'dead', no a 'no-heartbeat'. Lo correcto es no-heartbeat y tolerarlo en la UI.", summary: "Tomo el pedido" },
      replyTo: null, inReplyTo: "demo-r1", ttlSec: 900, createdAt: iso(200), priority: "normal", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-q1", seq: 4, from: "e-mesa-visual", to: ["e-testing-api-tester"], kind: "HELP_QUESTION", subject: "T-03",
      body: { text: "¿El roster expone lastHeartbeat en ISO o en epoch? Si es epoch tengo que parsear distinto.", need: "confirmar formato de lastHeartbeat" },
      replyTo: null, inReplyTo: "demo-a1", ttlSec: 900, createdAt: iso(160), priority: "normal", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-a2", seq: 5, from: "e-testing-api-tester", to: ["e-mesa-visual"], kind: "HELP_ACCEPT", subject: "T-03",
      body: { answer: "ISO 8601 con Z. Si viene null, el agente nunca latió: no-heartbeat.", detail: "Verificado contra roster.json de la corrida actual." },
      replyTo: null, inReplyTo: "demo-q1", ttlSec: 900, createdAt: iso(120), priority: "normal", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-s1", seq: 6, from: "e-mesa-visual", to: ["*"], kind: "STATUS", subject: "T-03",
      body: { summary: "Resuelto con la respuesta de e-testing-api-tester. Queda pendiente el pulse animation.", state: "in_progress" },
      replyTo: null, inReplyTo: "demo-r1", ttlSec: 900, createdAt: iso(90), priority: "normal", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-d1", seq: 7, from: "e-arch", to: ["e-bus-threading"], kind: "HELP_DECLINE", subject: "T-04",
      body: { reason: "No puedo decidir contratos de datos: eso es del Architect. Escalá por coord-arch.", why: "fuera de mi territorio" },
      replyTo: null, inReplyTo: "demo-r2", ttlSec: 900, createdAt: iso(130), priority: "normal", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-r3", seq: 8, from: "e-gates-panel", to: ["*"], kind: "HELP_REQUEST", subject: "T-09",
      body: { need: "El gate 7 me devuelve criterios sin índice; no puedo linkear la evidencia al criterio correcto.", why_me: "mi may_touch es dashboard/**, no puedo tocar el motor de gates" },
      replyTo: null, inReplyTo: null, ttlSec: 900, createdAt: iso(300), priority: "critical", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-p1", seq: 9, from: "e-testing-api-tester", to: ["e-gates-panel"], kind: "HELP_PARTIAL", subject: "T-09",
      body: { answer: "Puedo darte el shape de acceptance indexado, pero el fix va en src/core/evidence.ts y eso no lo toco.", detail: "Te paso un fixture con el índice explícito para que testees el panel." },
      replyTo: null, inReplyTo: "demo-r3", ttlSec: 900, createdAt: iso(280), priority: "critical", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-s2", seq: 10, from: "e-gates-panel", to: ["*"], kind: "STATUS", subject: "T-09",
      body: { summary: "Cierro con el fixture parcial: el link por índice funciona cuando viene, si no cae al texto.", state: "done" },
      replyTo: null, inReplyTo: "demo-r3", ttlSec: 900, createdAt: iso(270), priority: "normal", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-noise-1", seq: 11, from: "e-mesa-visual", to: ["e-testing-api-tester"], kind: "HELP_REQUEST", subject: "T-03",
      body: { need: "Pedido directo a un solo peer: no es debate, no debe abrir hilo." },
      replyTo: null, inReplyTo: null, ttlSec: 900, createdAt: iso(100), priority: "low", idempotencyKey: null, hops: 0, channel: "peer",
    },
    {
      id: "demo-noise-2", seq: 12, from: "oficina-director", to: ["*"], kind: "STATUS", subject: "T-00",
      body: { summary: "Broadcast de estado sin pedido de ayuda: no abre debate." },
      replyTo: null, inReplyTo: null, ttlSec: 900, createdAt: iso(80), priority: "normal", idempotencyKey: null, hops: 0, channel: "peer",
    },
  ];

  var agents = {
    "e-mesa-visual": { id: "e-mesa-visual", displayName: "Mesa Visual", role: "frontend-developer", state: "working" },
    "e-bus-threading": { id: "e-bus-threading", displayName: "Bus Threading", role: "frontend-developer", state: "working" },
    "e-testing-api-tester": { id: "e-testing-api-tester", displayName: "API Tester", role: "testing-api-tester", state: "idle_available" },
    "e-gates-panel": { id: "e-gates-panel", displayName: "Gates Panel", role: "frontend-developer", state: "working" },
    "e-arch": { id: "e-arch", displayName: "Architect", role: "architect", state: "idle_available" },
    "oficina-director": { id: "oficina-director", displayName: "Director", role: "director", state: "working" },
  };

  var cards = {
    "T-03": { id: "T-03", title: "Mesa visual en vivo", state: "in_progress" },
    "T-04": { id: "T-04", title: "Bus de mensajes con threading", state: "in_progress" },
    "T-09": { id: "T-09", title: "Panel de gates y evidencia", state: "in_progress" },
    "T-00": { id: "T-00", title: "Guard anti-gate-verde-vacío", state: "done" },
  };

  root.DebateDemo = function demoSnapshot() {
    return {
      ok: true,
      demo: true,
      generatedAt: new Date(now).toISOString(),
      messages: messages.slice(),
      agents: agents,
      cards: cards,
      acks: {
        "demo-r1": [{ agentId: "e-testing-api-tester", ackedAt: iso(210) }, { agentId: "e-gates-panel", ackedAt: iso(205) }],
        "demo-r2": [{ agentId: "e-arch", ackedAt: iso(140) }],
      },
      warnings: [],
    };
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
