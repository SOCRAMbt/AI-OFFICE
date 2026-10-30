#!/usr/bin/env node
/**
 * kanban.check.mjs — verificación real del Kanban (sin browser, sin jsdom).
 *
 * Qué prueba:
 *   A. Contrato estático de `kanban.html`: 7 columnas, controles de filtro,
 *      dialog de detalle, badges de gate, drag-drop visual y autosuficiencia
 *      (nada de CDNs: tiene que abrir con file://).
 *   B. Lógica pura de `kanban-source.js` ejecutada en `node:vm` (el mismo
 *      archivo que carga el browser): normalización, filtros, agrupación,
 *      badges, checklist, HTML de card y de modal.
 *   C. Dataset embebido en el HTML: parsea, tiene la forma esperada y
 *      normalizeDataset no pierde cards.
 *   D. Parser de gates.md (`build-kanban-data.mjs`) contra un markdown real
 *      generado por `renderGate` (src/core/gates.ts).
 *
 * Uso: node dashboard/kanban.check.mjs
 * Exit code 0 solo si todo pasa.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import { parseGates } from "./build-kanban-data.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const htmlPath = path.join(here, "kanban.html")
const sourcePath = path.join(here, "kanban-source.js")

const results = []
function check(name, fn) {
  try {
    const detail = fn()
    results.push({ ok: true, name, detail: detail || "" })
  } catch (err) {
    results.push({ ok: false, name, detail: err.message })
  }
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error((label ? label + ": " : "") + "esperaba " + e + " y obtuve " + a)
}

function ok(condition, message) {
  if (!condition) throw new Error(message)
}

function includes(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error((label ? label + ": " : "") + "falta " + JSON.stringify(needle))
}

function notIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) throw new Error((label ? label + ": " : "") + "no debería contener " + JSON.stringify(needle))
}

// ─────────────────────────────────────────────────────────────────────────
// Carga de artefactos
// ─────────────────────────────────────────────────────────────────────────

const html = await fs.readFile(htmlPath, "utf8")
const source = await fs.readFile(sourcePath, "utf8")

// Ejecuta el mismo archivo que el browser carga como script clásico.
const sandbox = { console }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: "kanban-source.js" })
const Core = sandbox.KanbanSource
check("kanban-source.js expone KanbanSource", () => {
  ok(Core && typeof Core.normalizeDataset === "function", "no se exportó KanbanSource")
  return Object.keys(Core).length + " exports"
})

// ─────────────────────────────────────────────────────────────────────────
// A. Contrato estático del HTML
// ─────────────────────────────────────────────────────────────────────────

const EXPECTED_COLUMNS = [
  ["todo", "TODO"],
  ["in_progress", "IN_PROGRESS"],
  ["review", "REVIEW"],
  ["done", "DONE"],
  ["rework", "REWORK"],
  ["blocked", "BLOCKED"],
  ["escalated", "ESCALATED"]
]

check("A1 · las 7 columnas existen en el HTML (TODO..ESCALATED)", () => {
  for (const [id, label] of EXPECTED_COLUMNS) {
    includes(html, 'class="column" data-state="' + id + '"', "columna " + id)
    includes(html, 'id="col-' + id + '-title">' + label + "<", "título " + label)
    includes(html, 'data-cards="' + id + '"', "contenedor de cards " + id)
  }
  eq(Core.COLUMN_IDS, EXPECTED_COLUMNS.map(([id]) => id), "orden de columnas en la fuente")
  eq((html.match(/data-dropzone="true"/g) || []).length, 7, "dropzones")
  return "7 columnas + 7 dropzones"
})

check("A2 · filtros por owner, tipo y estado", () => {
  includes(html, 'id="filter-owner"', "select owner")
  includes(html, 'id="filter-type"', "select tipo")
  includes(html, 'id="filter-state"', "select estado")
  includes(source, "f.owner", "filtro owner en lógica")
  includes(source, "card.type !== f.type", "filtro tipo en lógica")
  includes(source, "card.state !== f.state", "filtro estado en lógica")
  return "3 selects + lógica matchesFilters"
})

check("A3 · dialog modal con detalle completo", () => {
  includes(html, "<dialog id=\"card-modal\"", "dialog")
  includes(html, 'aria-labelledby="card-modal-title"', "label del dialog")
  for (const section of ["scope", "acceptance", "gate", "artifacts", "evidence"]) {
    includes(source, 'data-detail="' + section + '"', "sección " + section)
  }
  includes(html, "modalContent.innerHTML = Core.modalHtml(card)", "render del modal")
  includeFocusTrap()
  return "scope · acceptance · gate · artifacts · evidence"

  function includeFocusTrap() {
    includes(html, 'id="card-modal-close"', "botón cerrar")
    includes(html, "modal.showModal()", "showModal")
  }
})

check("A4 · badges PASS / FAIL / NOT_RUN con colores distintos", () => {
  eq(Core.GATE_LABELS, { pass: "PASS", fail: "FAIL", not_run: "NOT_RUN", na: "N/A" }, "labels")
  const css = {
    pass: /\.gate-badge--pass\s*\{\s*color:\s*var\(--accent\)/.test(html),
    fail: /\.gate-badge--fail\s*\{\s*color:\s*var\(--danger\)/.test(html),
    notRun: /\.gate-badge--not-run\s*\{\s*color:\s*var\(--warn\)/.test(html)
  }
  ok(css.pass && css.fail && css.notRun, "faltan reglas de color por outcome: " + JSON.stringify(css))
  includes(html, "--accent: #4ADE80", "token accent")
  includes(html, "--danger: #F87171", "token danger")
  includes(html, "--warn: #FBBF24", "token warn")
  return "PASS=accent FAIL=danger NOT_RUN=warn"
})

check("A5 · drag-drop visual, sin persistencia", () => {
  includes(source, 'draggable="true"', "cards draggables")
  for (const handler of ["onDragStart", "onDragOver", "onDrop", "onDragEnd"]) {
    includes(html, handler, "handler " + handler)
  }
  const start = html.indexOf("// DRAG-DROP:start")
  const end = html.indexOf("// DRAG-DROP:end")
  ok(start !== -1 && end > start, "faltan los markers del bloque drag-drop")
  const dnd = html.slice(start, end)
  for (const forbidden of ["fetch(", "localStorage", "sessionStorage", "XMLHttpRequest", "navigator.sendBeacon"]) {
    notIncludes(dnd, forbidden, "drag-drop no debe persistir")
  }
  includes(dnd, "data-visual-state", "marca visual del destino")
  includes(dnd, "no persiste", "el usuario ve que no persiste")
  return "drop mueve el nodo, no escribe storage ni red"
})

check("A6 · autosuficiente: abre con file:// (sin CDNs ni módulos)", () => {
  notIncludes(html, 'type="module"', "no puede usar type=module (bloqueado en file://)")
  includes(html, '<script src="./kanban-source.js"></script>', "script clásico local")
  const remote = /(?:src|href)="https?:\/\//g.exec(html)
  ok(!remote, "referencia remota encontrada: " + (remote ? remote[0] : ""))
  notIncludes(html, "transition: all", "DESIGN.md prohíbe transition:all")
  includes(html, "prefers-reduced-motion", "motion reducido")
  includes(html, 'role="status" aria-live="polite"', "aria-live para anuncios")
  return "sin red, sin build step, con fallback de movimiento"
})

// ─────────────────────────────────────────────────────────────────────────
// B. Lógica pura
// ─────────────────────────────────────────────────────────────────────────

const fixture = {
  meta: { runId: "run-test", objective: "fixture", status: "running" },
  agents: {
    "e-alpha": { id: "e-alpha", displayName: "Alpha Dev", role: "frontend", state: "working" },
    "e-beta": { id: "e-beta", displayName: "Beta Reviewer", role: "qa", state: "idle_available" }
  },
  cards: [
    {
      id: "T-01",
      title: "card <con> html & comillas \"x\"",
      type: "implementation",
      state: "todo",
      owner: "e-alpha",
      reviewer: "e-beta",
      acceptance: ["criterio A", "criterio B", "criterio C"],
      gate: "npm test",
      scope: { mayTouch: ["dashboard/**"], forbidden: ["src/**"] },
      rejections: 2,
      attempts: 3,
      dependsOn: ["T-00"],
      artifacts: ".oficina\\artifacts\\T-01",
      result: null
    },
    { id: "T-02", title: "review", type: "testing", state: "review", owner: null, reviewer: "e-beta", acceptance: [], scope: { mayTouch: [], forbidden: [] }, gate: "g", rejections: 0, attempts: 0, artifacts: ".oficina\\artifacts\\T-02" },
    { id: "T-03", title: "done", type: "docs", state: "done", owner: "e-beta", reviewer: null, acceptance: ["ok"], scope: { mayTouch: [], forbidden: [] }, gate: "g", rejections: 0, attempts: 1, artifacts: ".oficina\\artifacts\\T-03" },
    { id: "T-04", title: "blocked", type: "infra", state: "blocked", owner: "e-alpha", reviewer: null, acceptance: [], scope: { mayTouch: [], forbidden: [] }, gate: "g", rejections: 0, attempts: 0, artifacts: ".oficina\\artifacts\\T-04" },
    { id: "T-05", title: "escalated", type: "security", state: "escalated", owner: null, reviewer: null, acceptance: [], scope: { mayTouch: [], forbidden: [] }, gate: "g", rejections: 0, attempts: 0, artifacts: ".oficina\\artifacts\\T-05" },
    { id: "T-06", title: "rework", type: "bugfix", state: "rework", owner: "e-alpha", reviewer: "e-beta", acceptance: [], scope: { mayTouch: [], forbidden: [] }, gate: "g", rejections: 1, attempts: 2, artifacts: ".oficina\\artifacts\\T-06" },
    { id: "T-07", title: "in progress", type: "implementation", state: "in_progress", owner: "e-alpha", reviewer: null, acceptance: [], scope: { mayTouch: [], forbidden: [] }, gate: "g", rejections: 0, attempts: 0, artifacts: ".oficina\\artifacts\\T-07" },
    { id: "T-08", title: "estado desconocido", type: "refactor", state: "mystery", owner: null, reviewer: null, acceptance: [], scope: { mayTouch: [], forbidden: [] }, gate: "g", rejections: 0, attempts: 0, artifacts: "" }
  ],
  gates: {
    "T-01": {
      ranAt: "2026-10-29T10:00:00.000Z",
      technical: [{ phase: "build", command: "npm run build", outcome: "pass", detail: "exit 0", reason: "" }],
      security: [{ phase: "secrets", command: "scan", outcome: "pass", detail: "0 hallazgos", reason: "" }],
      technicalOutcome: "pass",
      securityOutcome: "pass"
    },
    "T-03": {
      ranAt: "2026-10-29T11:00:00.000Z",
      technical: [{ phase: "test", command: "npm test", outcome: "fail", detail: "1 failed", reason: "regresión" }],
      security: [],
      technicalOutcome: "fail",
      securityOutcome: "not_run"
    }
  },
  evidence: {
    "T-01": [
      { requirement: "criterio A", requirementIndex: 0, kind: "test", level: 2, ref: "tests/a.test.ts", note: "cubre A", passed: true },
      { requirement: "criterio B", requirementIndex: 1, kind: "artifact", level: 1, ref: "handoff.md", note: "documentado", passed: true }
    ],
    "T-03": [
      { requirement: "ok", requirementIndex: 0, kind: "export", level: 2, ref: "tests/x", passed: false }
    ]
  }
}

const view = Core.normalizeDataset(fixture)

check("B1 · normalizeDataset resuelve agentes y cards", () => {
  eq(view.cards.length, 8, "cards")
  eq(Object.keys(view.agents).sort(), ["e-alpha", "e-beta"], "agentes")
  const t1 = view.cards.find((c) => c.id === "T-01")
  eq(t1.owner.name, "Alpha Dev", "owner resuelto")
  eq(t1.reviewer.id, "e-beta", "reviewer resuelto")
  eq(t1.owner.initials, "AD", "iniciales del owner")
  return "8 cards · owners y reviewers normalizados"
})

check("B2 · estado desconocido cae en TODO (sin perder la card)", () => {
  const t8 = view.cards.find((c) => c.id === "T-08")
  eq(t8.state, "todo", "fallback de estado")
  eq(t8.rawState, "mystery", "estado original preservado")
  return "mystery → todo"
})

check("B3 · groupByColumn cubre las 7 columnas", () => {
  const groups = Core.groupByColumn(view.cards)
  eq(Object.keys(groups), EXPECTED_COLUMNS.map(([id]) => id), "claves")
  eq(groups.in_progress.map((c) => c.id), ["T-07"], "in_progress")
  eq(groups.done.map((c) => c.id), ["T-03"], "done")
  eq(groups.rework.map((c) => c.id), ["T-06"], "rework")
  eq(groups.blocked.map((c) => c.id), ["T-04"], "blocked")
  eq(groups.escalated.map((c) => c.id), ["T-05"], "escalated")
  return "todo=2 in_progress=1 review=1 done=1 rework=1 blocked=1 escalated=1"
})

check("B4 · filtro por owner (incluye sin asignar) y por tipo/estado/q", () => {
  eq(Core.filterCards(view.cards, { owner: "e-alpha" }).map((c) => c.id), ["T-01", "T-04", "T-06", "T-07"], "owner e-alpha")
  eq(Core.filterCards(view.cards, { owner: "unassigned" }).map((c) => c.id), ["T-02", "T-05", "T-08"], "sin asignar")
  eq(Core.filterCards(view.cards, { type: "implementation" }).map((c) => c.id), ["T-01", "T-07"], "tipo")
  eq(Core.filterCards(view.cards, { state: "review" }).map((c) => c.id), ["T-02"], "estado")
  eq(Core.filterCards(view.cards, { q: "rewor" }).map((c) => c.id), ["T-06"], "búsqueda por título")
  eq(Core.filterCards(view.cards, { owner: "e-alpha", type: "implementation", state: "in_progress" }).map((c) => c.id), ["T-07"], "filtros combinados")
  return "owner · unassigned · type · state · q · combinado"
})

check("B5 · gateBadge mapea los tres estados visibles", () => {
  eq(Core.gateBadge("pass").label, "PASS", "pass")
  eq(Core.gateBadge("pass").className, "gate-badge gate-badge--pass", "clase pass")
  eq(Core.gateBadge("FAIL").label, "FAIL", "fail")
  eq(Core.gateBadge("fail").className, "gate-badge gate-badge--fail", "clase fail")
  eq(Core.gateBadge("not_run").label, "NOT_RUN", "not_run")
  eq(Core.gateBadge(undefined).label, "NOT_RUN", "ausente → NOT_RUN")
  eq(Core.gateBadge("na").label, "N/A", "na")
  return "PASS · FAIL · NOT_RUN · N/A"
})

check("B6 · gate de requisitos derivado de la evidencia", () => {
  eq(Core.requirementsOutcome([]), "na", "sin criterios")
  eq(Core.requirementsOutcome([{ evidence: [{ passed: true }] }, { evidence: [{ passed: true }] }]), "pass", "todo cubierto")
  eq(Core.requirementsOutcome([{ evidence: [{ passed: true }] }, { evidence: [] }]), "not_run", "cobertura incompleta ≠ pass")
  eq(Core.requirementsOutcome([{ evidence: [{ passed: false }] }]), "fail", "evidencia de fallo")
  return "na · pass · not_run · fail"
})

check("B7 · gateOutcome agrega sin promediar (FAIL > NOT_RUN > PASS)", () => {
  const gate = (t, s, r) => ({ technical: { outcome: t }, security: { outcome: s }, requirements: { outcome: r } })
  eq(Core.gateOutcome(gate("pass", "pass", "pass")), "pass", "todo verde")
  eq(Core.gateOutcome(gate("pass", "fail", "pass")), "fail", "un fail alcanza")
  eq(Core.gateOutcome(gate("pass", "pass", "not_run")), "not_run", "not_run no es verde")
  eq(Core.gateOutcome(gate("na", "na", "na")), "na", "todo n/a")
  eq(Core.gateOutcome(null), "not_run", "sin gate")
  return "sin promedios: fail domina, not_run bloquea"
})

check("B8 · acceptanceProgress y checklist por card", () => {
  const t1 = view.cards.find((c) => c.id === "T-01")
  eq(Core.acceptanceProgress(t1), { total: 3, covered: 2, missing: 1, pct: 67 }, "progreso T-01")
  eq(t1.acceptance[0].satisfied, true, "criterio 0 cubierto")
  eq(t1.acceptance[2].satisfied, false, "criterio 2 sin evidencia")
  const t3 = view.cards.find((c) => c.id === "T-03")
  eq(t3.gate.requirements.outcome, "fail", "evidencia passed:false → FAIL")
  eq(t3.gateOutcome, "fail", "gate agregado T-03")
  return "2/3 · evidencia enlazada por índice y por texto"
})

check("B9 · cardHtml expone id, título, avatares, rechazos, checklist y badges", () => {
  const t1 = view.cards.find((c) => c.id === "T-01")
  const htmlCard = Core.cardHtml(t1)
  includes(htmlCard, 'data-card-id="T-01"', "id")
  includes(htmlCard, "card &lt;con&gt; html &amp; comillas &quot;x&quot;", "título escapado")
  notIncludes(htmlCard, "<con>", "no debe inyectar HTML del título")
  includes(htmlCard, 'data-owner="e-alpha"', "owner")
  includes(htmlCard, 'data-reviewer="e-beta"', "reviewer")
  includes(htmlCard, ">AD<", "iniciales owner")
  includes(htmlCard, 'data-rejections="2"', "rejection count")
  includes(htmlCard, "criterio A", "checklist")
  includes(htmlCard, "check-item is-checked", "criterio cubierto")
  includes(htmlCard, "check-item is-empty", "criterio sin evidencia")
  includes(htmlCard, 'data-outcome="pass"', "badge PASS")
  includes(htmlCard, 'data-outcome="not_run"', "badge NOT_RUN")
  includes(htmlCard, 'draggable="true"', "draggable")
  includes(htmlCard, 'role="button"', "accesible por teclado")

  const t2 = view.cards.find((c) => c.id === "T-02")
  const htmlUnassigned = Core.cardHtml(t2)
  includes(htmlUnassigned, "sin asignar", "sin owner")
  includes(htmlUnassigned, "sin criterios declarados", "sin criterios")
  return "T-01 completo + T-02 sin owner"
})

check("B10 · modalHtml incluye scope, acceptance, gate, artifacts y evidence", () => {
  const t1 = view.cards.find((c) => c.id === "T-01")
  const modal = Core.modalHtml(t1)
  for (const section of ["scope", "acceptance", "gate", "artifacts", "evidence"]) {
    includes(modal, 'data-detail="' + section + '"', "sección " + section)
  }
  includes(modal, "<code>dashboard/**</code>", "mayTouch")
  includes(modal, "<code>src/**</code>", "forbidden")
  includes(modal, "criterio A", "acceptance")
  includes(modal, "npm test", "gate")
  includes(modal, "../.oficina/artifacts/T-01/handoff.md", "link handoff")
  includes(modal, "../.oficina/artifacts/T-01/evidence.md", "link evidence")
  includes(modal, "../.oficina/artifacts/T-01/gates.md", "link gates")
  includes(modal, "tests/a.test.ts", "evidencia citada")
  includes(modal, "data-evidence-kind=\"test\"", "tipo de evidencia")
  includes(modal, 'data-gate-section="technical"', "gate técnico")
  includes(modal, 'data-gate-section="requirements"', "gate de requisitos")
  notIncludes(modal, 'class="detail-result"', "sin result no inventa un veredicto")
  notIncludes(modal, "transition: all", "sin animación global")
  return "5 secciones + links a artifacts y evidencia"
})

check("B11 · helpers deterministas", () => {
  eq(Core.initials("e-xr-immersive-developer"), "XD", "iniciales de id")
  eq(Core.initials(""), "·", "vacío")
  eq(Core.formatRelative("2026-10-29T10:00:00.000Z", Date.parse("2026-10-29T10:05:00.000Z")), "hace 5m", "relativo")
  eq(Core.percent(0, 0), 0, "división por cero")
  eq(Core.escapeHtml("<a href=\"x\">&'"), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;", "escape")
  return "initials · formatRelative · percent · escapeHtml"
})

// ─────────────────────────────────────────────────────────────────────────
// C. Dataset embebido real
// ─────────────────────────────────────────────────────────────────────────

check("C1 · dataset embebido parsea y tiene la forma esperada", () => {
  const match = /<script[^>]+id="kanban-dataset"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  ok(match, "no encontré el script #kanban-dataset")
  const dataset = JSON.parse(match[1])
  ok(Array.isArray(dataset.cards), "cards no es array")
  ok(dataset.cards.length > 0, "el dataset está vacío: corré node dashboard/build-kanban-data.mjs")
  const real = Core.normalizeDataset(dataset)
  eq(real.cards.length, dataset.cards.length, "cards normalizadas")
  const allowed = ["pass", "fail", "not_run", "na"]
  for (const card of real.cards) {
    ok(allowed.includes(card.gateOutcome), "gateOutcome inválido en " + card.id)
    ok(typeof card.title === "string" && card.title.length > 0, "título vacío en " + card.id)
    ok(Array.isArray(card.acceptance), "acceptance no es array en " + card.id)
    ok(card.scope && Array.isArray(card.scope.mayTouch), "scope inválido en " + card.id)
  }
  return dataset.cards.length + " cards reales · " + Object.keys(dataset.agents).length + " agentes"
})

check("C2 · el HTML renderiza datos reales sin placeholder", () => {
  const match = /<script[^>]+id="kanban-dataset"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  const dataset = JSON.parse(match[1])
  const real = Core.normalizeDataset(dataset)
  const seeded = dataset.cards.filter((card) => card.id === "T-07")
  ok(seeded.length === 1, "falta la card T-07 en el snapshot")
  const rendered = Core.columnBodyHtml({ id: "todo", label: "TODO", hint: "" }, [real.cards.find((c) => c.id === "T-07")])
  includes(rendered, 'data-card-id="T-07"', "render de T-07")
  return "T-07 presente y renderizable"
})

// ─────────────────────────────────────────────────────────────────────────
// D. Parser de gates.md
// ─────────────────────────────────────────────────────────────────────────

check("D1 · parseGates lee el formato de renderGate", () => {
  const markdown = [
    "# Gates — T-99",
    "",
    "**Corredor:** 2026-10-29T03:28:55.630Z",
    "",
    "## Técnico",
    "",
    "| # | Fase | Comando | Resultado | Detalle | Motivo |",
    "|---|------|---------|-----------|---------|--------|",
    "| 1 | build | `npm run build` | PASS | exit 0 en 11254ms | — |",
    "| 2 | test | `npm test` | FAIL | exit 1 | regresión en gates |",
    "",
    "## Seguridad",
    "",
    "| # | Fase | Comando | Resultado | Detalle | Motivo |",
    "|---|------|---------|-----------|---------|--------|",
    "| 1 | secrecy | `scan` | NA | sin scanner | — |",
    "",
    "**Gate técnico:** FAIL",
    "",
    "**Gate seguridad:** NA",
    "",
    "**Veredicto:** FAIL"
  ].join("\n")
  const parsed = parseGates(markdown)
  eq(parsed.ranAt, "2026-10-29T03:28:55.630Z", "corredor")
  eq(parsed.technical.length, 2, "fases técnicas")
  eq(parsed.technical[1].outcome, "fail", "FAIL parseado")
  eq(parsed.technical[1].reason, "regresión en gates", "motivo")
  eq(parsed.security.length, 1, "fases de seguridad")
  eq(parsed.security[0].outcome, "na", "NA parseado")
  eq(parsed.technicalOutcome, "fail", "outcome técnico")
  eq(parsed.securityOutcome, "na", "outcome seguridad")
  eq(parsed.verdict, "fail", "veredicto")
  eq(parseGates("").verdict, "not_run", "sin gates.md")
  return "fases + outcomes + motivo + not_run sin archivo"
})

// ─────────────────────────────────────────────────────────────────────────
// Reporte
// ─────────────────────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok)
const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) {
  const status = r.ok ? "PASS" : "FAIL"
  console.log(status + "  " + r.name.padEnd(width) + "  " + r.detail)
}
console.log("")
console.log((results.length - failed.length) + "/" + results.length + " checks en verde" + (failed.length ? " · " + failed.length + " FALLARON" : ""))
process.exitCode = failed.length ? 1 : 0
