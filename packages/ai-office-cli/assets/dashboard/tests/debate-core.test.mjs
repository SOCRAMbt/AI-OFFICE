/*
 * Tests de la lógica del panel de debate (T-05).
 *
 * `debate-core.js` es un script clásico (para servir por file:// y por HTTP),
 * así que se evalúa en un contexto `vm` con el mismo `globalThis` que tendría
 * el navegador. Se corre con: `node --test dashboard/tests`
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/debate-core.js", import.meta.url), "utf8");
const context = vm.createContext({ console });
vm.runInContext(source, context);
const core = context.DebateCore;

// Los arrays creados dentro del contexto `vm` tienen otro prototipo: se
// convierten al realm del test antes de comparar con deepEqual.
const arr = (value) => Array.from(value);

const NOW = Date.parse("2026-10-29T12:00:00.000Z");

function msg(overrides) {
  return {
    id: overrides.id,
    seq: overrides.seq ?? 1,
    from: overrides.from ?? "e-a",
    to: overrides.to ?? ["*"],
    kind: overrides.kind ?? "HELP_REQUEST",
    subject: overrides.subject ?? "T-05",
    body: overrides.body ?? { need: "necesito una mano", why_me: "no me da el scope" },
    replyTo: null,
    inReplyTo: overrides.inReplyTo ?? null,
    ttlSec: overrides.ttlSec ?? 900,
    createdAt: overrides.createdAt ?? "2026-10-29T11:55:00.000Z",
    priority: overrides.priority ?? "normal",
    idempotencyKey: null,
    hops: 0,
  };
}

test("el módulo expone la API esperada", () => {
  for (const fn of ["buildThreads", "isBroadcastHelpRequest", "threadStatus", "filterThreads", "newMessages"]) {
    assert.equal(typeof core[fn], "function", fn);
  }
});

test("detecta HELP_REQUEST broadcast to:['*'] y descarta el resto", () => {
  const broadcast = core.normalizeMessage(msg({ id: "m1" }));
  const direct = core.normalizeMessage(msg({ id: "m2", to: ["e-x"] }));
  const statusBroadcast = core.normalizeMessage(msg({ id: "m3", kind: "STATUS" }));

  assert.equal(core.isBroadcastHelpRequest(broadcast), true);
  assert.equal(core.isBroadcastHelpRequest(direct), false, "un pedido a un solo agente no es broadcast");
  assert.equal(core.isBroadcastHelpRequest(statusBroadcast), false, "STATUS broadcast no abre debate");

  assert.equal(core.isDebateRoot(broadcast), true);
  assert.equal(core.isDebateRoot(direct), false);
});

test("normaliza envelopes tolerando basura sin tirar mensajes válidos", () => {
  assert.equal(core.normalizeMessage(null), null);
  assert.equal(core.normalizeMessage({ kind: "HELP_REQUEST" }), null, "sin id no sirve");
  assert.equal(core.normalizeMessage({ id: "m1" }), null, "sin createdAt válido no sirve");

  const parsed = core.normalizeMessage({
    id: "m1",
    from: "e-a",
    to: "*",
    kind: "help_request",
    createdAt: "2026-10-29T11:55:00.000Z",
    body: null,
    ttlSec: -3,
    priority: "URGENTE",
  });
  assert.deepEqual(arr(parsed.to), ["*"], "acepta to como string");
  assert.equal(parsed.kind, "HELP_REQUEST", "normaliza el kind a mayúsculas");
  assert.equal(parsed.ttlSec, 900, "ttl inválido cae al default");
  assert.equal(parsed.priority, "normal", "prioridad desconocida cae a normal");
  assert.deepEqual({ ...parsed.body }, {});
});

test("anida respuestas bajo el request, incluyendo respuestas a respuestas", () => {
  const snapshot = core.readSnapshot({
    messages: [
      msg({ id: "r1", seq: 1 }),
      msg({ id: "a1", seq: 2, from: "e-b", kind: "HELP_ACCEPT", inReplyTo: "r1", createdAt: "2026-10-29T11:56:00.000Z" }),
      msg({ id: "q1", seq: 3, from: "e-c", kind: "HELP_QUESTION", inReplyTo: "a1", createdAt: "2026-10-29T11:57:00.000Z" }),
      msg({ id: "p1", seq: 4, from: "e-d", kind: "HELP_PARTIAL", inReplyTo: "r1", createdAt: "2026-10-29T11:58:00.000Z" }),
    ],
  });

  const built = core.buildThreads(snapshot.messages, { now: NOW });
  assert.equal(built.threads.length, 1);
  const thread = built.threads[0];
  assert.equal(thread.id, "r1");
  assert.equal(thread.replyCount, 3, "la respuesta a una respuesta queda en el mismo hilo");
  assert.deepEqual(arr(thread.replies).map((m) => m.id), ["a1", "q1", "p1"], "orden cronológico");
  assert.deepEqual(arr(thread.participants).sort(), ["e-a", "e-b", "e-c", "e-d"]);
  assert.equal(thread.counts.accept, 1);
  assert.equal(thread.counts.partial, 1);
  assert.equal(thread.counts.question, 1);
  assert.equal(built.unlinked.length, 0);
});

test("reengancha huérfanas por subject único y no adivina si es ambiguo", () => {
  const unique = core.buildThreads(
    [
      core.normalizeMessage(msg({ id: "r1", subject: "T-05" })),
      core.normalizeMessage(
        msg({ id: "a1", from: "e-b", kind: "HELP_ACCEPT", inReplyTo: "m-vencido", subject: "T-05", createdAt: "2026-10-29T11:56:00.000Z" }),
      ),
    ],
    { now: NOW },
  );
  assert.equal(unique.threads[0].replyCount, 1, "se reengancha por subject");
  assert.equal(unique.threads[0].replies[0].reattached, true);
  assert.equal(unique.unlinked.length, 0);

  const ambiguous = core.buildThreads(
    [
      core.normalizeMessage(msg({ id: "r1", from: "e-a", subject: "T-05" })),
      core.normalizeMessage(msg({ id: "r2", seq: 2, from: "e-z", subject: "T-05" })),
      core.normalizeMessage(
        msg({ id: "a1", from: "e-b", kind: "HELP_ACCEPT", inReplyTo: "m-vencido", subject: "T-05", createdAt: "2026-10-29T11:56:00.000Z" }),
      ),
    ],
    { now: NOW },
  );
  assert.equal(ambiguous.unlinked.length, 1, "con dos hilos del mismo subject no se adivina");
  assert.equal(ambiguous.unlinked[0].id, "a1");
});

test("máquina de estados pending -> accepted -> completed", () => {
  const base = [msg({ id: "r1" })];
  const pending = core.buildThreads(base, { now: NOW }).threads[0];
  assert.equal(pending.status, "pending");
  assert.equal(core.statusLabel(pending.status), "Esperando respuesta");

  const accepted = core.buildThreads(
    base.concat([msg({ id: "a1", from: "e-b", kind: "HELP_ACCEPT", inReplyTo: "r1", createdAt: "2026-10-29T11:56:00.000Z" })]),
    { now: NOW },
  ).threads[0];
  assert.equal(accepted.status, "accepted", "aceptar no cierra el hilo");

  const completed = core.buildThreads(
    base.concat([
      msg({ id: "a1", from: "e-b", kind: "HELP_ACCEPT", inReplyTo: "r1", createdAt: "2026-10-29T11:56:00.000Z" }),
      msg({
        id: "s1",
        from: "e-a",
        kind: "STATUS",
        inReplyTo: "r1",
        body: { summary: "resuelto con lo que me pasó e-b" },
        createdAt: "2026-10-29T11:59:00.000Z",
      }),
    ]),
    { now: NOW },
  ).threads[0];
  assert.equal(completed.status, "completed");
});

test("declined y partial tienen su propio estado; partial vencido completa", () => {
  const declined = core.buildThreads(
    [msg({ id: "r1" }), msg({ id: "d1", from: "e-b", kind: "HELP_DECLINE", inReplyTo: "r1", createdAt: "2026-10-29T11:56:00.000Z" })],
    { now: NOW },
  ).threads[0];
  assert.equal(declined.status, "declined");

  const partial = core.buildThreads(
    [msg({ id: "r1" }), msg({ id: "p1", from: "e-b", kind: "HELP_PARTIAL", inReplyTo: "r1", createdAt: "2026-10-29T11:56:00.000Z" })],
    { now: NOW },
  ).threads[0];
  assert.equal(partial.status, "partial");

  const expiredPartial = core.buildThreads(
    [
      msg({ id: "r1", createdAt: "2026-10-29T10:00:00.000Z", ttlSec: 60 }),
      msg({ id: "p1", from: "e-b", kind: "HELP_PARTIAL", inReplyTo: "r1", createdAt: "2026-10-29T10:00:30.000Z" }),
    ],
    { now: NOW },
  ).threads[0];
  assert.equal(expiredPartial.status, "completed", "TTL vencido con respuesta cierra el hilo");
  assert.equal(expiredPartial.expired, true);
});

test("solo preguntas deja el hilo pendiente", () => {
  const thread = core.buildThreads(
    [msg({ id: "r1" }), msg({ id: "q1", from: "e-b", kind: "HELP_QUESTION", inReplyTo: "r1", createdAt: "2026-10-29T11:56:00.000Z" })],
    { now: NOW },
  ).threads[0];
  assert.equal(thread.status, "pending");
  assert.equal(thread.counts.question, 1);
});

test("hilos ordenados por actividad y conteo global por estado", () => {
  const built = core.buildThreads(
    [
      msg({ id: "r1", seq: 1, from: "e-a", createdAt: "2026-10-29T11:50:00.000Z" }),
      msg({ id: "r2", seq: 2, from: "e-b", createdAt: "2026-10-29T11:58:00.000Z" }),
      msg({ id: "a1", from: "e-c", kind: "HELP_ACCEPT", inReplyTo: "r1", createdAt: "2026-10-29T11:59:00.000Z" }),
    ],
    { now: NOW },
  );
  assert.deepEqual(arr(built.threads).map((t) => t.id), ["r1", "r2"], "el más reciente arriba");
  const counts = core.statusCounts(built.threads);
  assert.equal(counts.all, 2);
  assert.equal(counts.accepted, 1);
  assert.equal(counts.pending, 1);
});

test("filtra por estado, agente y texto (con acentos)", () => {
  const built = core.buildThreads(
    [
      msg({ id: "r1", from: "e-a", body: { need: "Revisión de accesibilidad" } }),
      msg({ id: "a1", from: "e-b", kind: "HELP_ACCEPT", inReplyTo: "r1", subject: "T-05", createdAt: "2026-10-29T11:56:00.000Z" }),
      msg({ id: "r2", seq: 2, from: "e-c", subject: "T-06", body: { need: "contratos de API" }, createdAt: "2026-10-29T11:50:00.000Z" }),
    ],
    { now: NOW },
  );

  assert.equal(core.filterThreads(built.threads, { status: "accepted" }).length, 1);
  assert.equal(core.filterThreads(built.threads, { status: "pending" })[0].id, "r2");
  assert.equal(core.filterThreads(built.threads, { agent: "e-b" })[0].id, "r1");
  assert.equal(core.filterThreads(built.threads, { query: "revision" }).length, 1, "ignora acentos");
  assert.equal(core.filterThreads(built.threads, { query: "contratos" })[0].id, "r2");
  assert.equal(core.filterThreads(built.threads, { query: "nada-que-ver" }).length, 0);
  assert.equal(core.filterThreads(built.threads, { onlyPending: true }).length, 1);
});

test("detecta mensajes nuevos y respeta hilos abiertos", () => {
  const first = core.buildThreads([msg({ id: "r1" })], { now: NOW });
  const seen = core.idsMap(first.messages);

  const second = core.buildThreads(
    [msg({ id: "r1" }), msg({ id: "a1", from: "e-b", kind: "HELP_ACCEPT", inReplyTo: "r1", createdAt: "2026-10-29T11:56:00.000Z" })],
    { now: NOW },
  );

  const all = core.newMessages(seen, second.threads);
  assert.equal(all.length, 1);
  assert.equal(all[0].message.id, "a1");
  assert.equal(all[0].threadId, "r1");
  assert.equal(all[0].isRoot, false);

  const closed = core.newMessages(seen, second.threads, { onlyOpen: true, openThreads: {} });
  assert.equal(closed.length, 0, "un hilo colapsado no anuncia");

  const opened = core.newMessages(seen, second.threads, { onlyOpen: true, openThreads: { r1: true } });
  assert.equal(opened.length, 1, "un hilo abierto sí anuncia");

  const announcement = core.announcementFor(opened[0]);
  assert.match(announcement, /Acepta de e-b/);
});

test("tiempo relativo y reloj", () => {
  assert.equal(core.relativeTime("2026-10-29T11:59:58.000Z", NOW), "ahora");
  assert.equal(core.relativeTime("2026-10-29T11:59:30.000Z", NOW), "hace 30s");
  assert.equal(core.relativeTime("2026-10-29T11:30:00.000Z", NOW), "hace 30m");
  assert.equal(core.relativeTime("2026-10-29T06:00:00.000Z", NOW), "hace 6h");
  assert.equal(core.relativeTime("2026-10-20T12:00:00.000Z", NOW), "hace 9d");
  assert.equal(core.relativeTime("2026-10-29T12:00:10.000Z", NOW), "en 10s");
  assert.equal(core.relativeTime("no-es-fecha", NOW), "—");
  assert.match(core.formatClock("2026-10-29T11:59:00.000Z"), /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(core.formatClock("no-es-fecha"), "--:--:--");
});

test("avatares: iniciales estables y hue determinista", () => {
  assert.equal(core.initials("e-testing-api-tester"), "TT");
  assert.equal(core.initials("API Tester"), "AT");
  assert.equal(core.initials("oficina"), "OF");
  assert.equal(core.initials(""), "?");
  assert.equal(core.agentHue("e-a"), core.agentHue("e-a"));
  assert.ok(core.agentHue("e-a") >= 0 && core.agentHue("e-a") < 360);
  assert.notEqual(core.agentHue("e-a"), core.agentHue("e-b"));
});

test("describeBody ordena claves conocidas y no pierde campos nuevos", () => {
  const parts = core.describeBody({
    need: "arreglar el gate",
    why_me: "no tengo permisos",
    zeta: "extra",
    alpha: 3,
  });
  assert.deepEqual(arr(parts).map((p) => p.key), ["need", "why_me", "alpha", "zeta"]);
  assert.equal(parts[0].label, "Necesita");
  assert.equal(parts[2].text, "3");
  assert.deepEqual(arr(core.describeBody(null)), []);
});

test("readSnapshot tolera formatos y reporta lo que descarta", () => {
  const fromArray = core.readSnapshot([msg({ id: "r1" })]);
  assert.equal(fromArray.messages.length, 1);
  assert.equal(fromArray.warnings.length, 0);

  const fromSingle = core.readSnapshot(msg({ id: "r1" }));
  assert.equal(fromSingle.messages.length, 1);

  const broken = core.readSnapshot({ messages: [msg({ id: "r1" }), { id: "malo" }] });
  assert.equal(broken.messages.length, 1);
  assert.equal(broken.warnings.length, 1);

  const empty = core.readSnapshot(null);
  assert.deepEqual(arr(empty.messages), []);
  assert.equal(empty.warnings.length, 1);

  const withMeta = core.readSnapshot({
    messages: [msg({ id: "r1" }), msg({ id: "r1" })],
    agents: { "e-a": { displayName: "A" } },
    cards: { "T-05": { title: "x" } },
    acks: { r1: [{ agentId: "e-b" }] },
    generatedAt: "2026-10-29T12:00:00.000Z",
  });
  assert.equal(withMeta.messages.length, 1, "deduplica por id");
  assert.equal(withMeta.agents["e-a"].displayName, "A");
  assert.equal(withMeta.meta.generatedAt, "2026-10-29T12:00:00.000Z");
  assert.deepEqual(arr(core.ackedBy(withMeta.acks, "r1")), ["e-b"]);
  assert.deepEqual(arr(core.ackedBy(withMeta.acks, "nope")), []);
});

test("la firma del snapshot cambia sólo cuando cambia el contenido", () => {
  const a = core.buildThreads([msg({ id: "r1" })], { now: NOW });
  const b = core.buildThreads([msg({ id: "r1" })], { now: NOW + 5000 });
  assert.equal(core.snapshotSignature(a.threads), core.snapshotSignature(b.threads));

  const c = core.buildThreads(
    [msg({ id: "r1" }), msg({ id: "a1", from: "e-b", kind: "HELP_ACCEPT", inReplyTo: "r1", createdAt: "2026-10-29T11:56:00.000Z" })],
    { now: NOW },
  );
  assert.notEqual(core.snapshotSignature(a.threads), core.snapshotSignature(c.threads));
});

test("escapeHtml neutraliza inyección en bodies", () => {
  assert.equal(core.escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});
