/**
 * kanban-source.js — lógica pura del Kanban de la Oficina.
 *
 * Este archivo no toca el DOM: recibe datos de la corrida y devuelve strings
 * HTML o valores primitivos. Eso permite ejecutarlo igual en el browser
 * (como script clásico, sin build step, y sin CORS aunque se abra con
 * `file://`) y en Node (el checker `kanban.check.mjs` lo evalúa en `node:vm`
 * y le corre assertions reales).
 *
 * Contrato de datos: ver `build-kanban-data.mjs`. El dataset tiene la forma
 *   { meta: {...}, agents: { [id]: Agent }, cards: [ViewCard] }
 * y `ViewCard` es la `Card` de `src/core/types.ts` normalizada para lectura.
 */
(function (global) {
  "use strict"

  // ───────────────────────────────────────────────────────────────────────
  // Constantes
  // ───────────────────────────────────────────────────────────────────────

  var COLUMNS = [
    { id: "todo", label: "TODO", hint: "sin empezar" },
    { id: "in_progress", label: "IN_PROGRESS", hint: "en ejecución" },
    { id: "review", label: "REVIEW", hint: "esperando revisor" },
    { id: "done", label: "DONE", hint: "cerrada con gates" },
    { id: "rework", label: "REWORK", hint: "rechazada, vuelve" },
    { id: "blocked", label: "BLOCKED", hint: "dependencia externa" },
    { id: "escalated", label: "ESCALATED", hint: "esperando decisión" }
  ]

  var COLUMN_IDS = COLUMNS.map(function (c) { return c.id })

  var GATE_LABELS = { pass: "PASS", fail: "FAIL", not_run: "NOT_RUN", na: "N/A" }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers de formato
  // ───────────────────────────────────────────────────────────────────────

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function (ch) {
      if (ch === "&") return "&amp;"
      if (ch === "<") return "&lt;"
      if (ch === ">") return "&gt;"
      if (ch === '"') return "&quot;"
      return "&#39;"
    })
  }

  function initials(name) {
    var raw = String(name || "").trim()
    if (!raw) return "·"
    var parts = raw.replace(/^e-/, "").split(/[\s._-]+/).filter(Boolean)
    if (parts.length === 0) return raw.slice(0, 2).toUpperCase()
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }

  /** Hash estable para colorear avatares por rol (sin depender del orden). */
  function hueFor(seed) {
    var text = String(seed || "")
    var h = 0
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360
    return h
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n))
  }

  function percent(part, total) {
    if (!total) return 0
    return clamp(Math.round((part / total) * 100), 0, 100)
  }

  function formatRelative(iso, now) {
    if (!iso) return "—"
    var then = new Date(iso).getTime()
    if (!Number.isFinite(then)) return "—"
    var base = typeof now === "number" ? now : Date.now()
    var diff = Math.max(0, base - then)
    var sec = Math.floor(diff / 1000)
    if (sec < 60) return "hace " + sec + "s"
    var min = Math.floor(sec / 60)
    if (min < 60) return "hace " + min + "m"
    var hours = Math.floor(min / 60)
    if (hours < 24) return "hace " + hours + "h"
    return "hace " + Math.floor(hours / 24) + "d"
  }

  // ───────────────────────────────────────────────────────────────────────
  // Normalización
  // ───────────────────────────────────────────────────────────────────────

  /** Un agente tal como lo necesita la UI: id, nombre, rol, iniciales. */
  function normalizeAgent(raw) {
    if (!raw) return null
    var id = raw.id || raw.agentId || ""
    if (!id) return null
    var name = raw.displayName || raw.name || raw.role || id
    return {
      id: id,
      name: name,
      role: raw.role || "",
      initials: initials(name),
      hue: hueFor(raw.role || id),
      state: raw.state || null,
      currentCard: raw.currentCard || null
    }
  }

  function normalizeGateOutcome(outcome) {
    var value = String(outcome || "").toLowerCase()
    if (value === "pass") return "pass"
    if (value === "fail") return "fail"
    if (value === "na") return "na"
    return "not_run"
  }

  /** Badge de gate: etiqueta + tono. Contrato: PASS / FAIL / NOT_RUN. */
  function gateBadge(outcome) {
    var normalized = normalizeGateOutcome(outcome)
    return {
      outcome: normalized,
      label: GATE_LABELS[normalized],
      className: "gate-badge gate-badge--" + normalized.replace(/_/g, "-"),
      tone: normalized === "pass" ? "pass" : normalized === "fail" ? "fail" : normalized === "na" ? "na" : "not-run"
    }
  }

  /**
   * Gate de requisitos derivado del grafo de evidencia.
   *
   * - `fail`    → alguna evidencia documenta un fallo (`passed: false`).
   * - `pass`    → todos los criterios tienen al menos una evidencia viva.
   * - `not_run` → no hay evidencia: el gate no se corrió, no que falló.
   * - `na`      → la card no declara criterios.
   */
  function requirementsOutcome(requirements) {
    var list = requirements || []
    if (list.length === 0) return "na"
    var failed = false
    var covered = 0
    for (var i = 0; i < list.length; i++) {
      var nodes = list[i].evidence || []
      var alive = nodes.filter(function (n) { return n && n.passed !== false })
      if (nodes.some(function (n) { return n && n.passed === false })) failed = true
      if (alive.length > 0) covered++
    }
    if (failed) return "fail"
    if (covered === list.length) return "pass"
    return "not_run"
  }

  /**
   * Outcome agregado de una card.
   * Prioridad: FAIL > NOT_RUN > PASS. Un gate sin correr no es un gate verde.
   */
  function gateOutcome(gate) {
    if (!gate) return "not_run"
    var outcomes = [
      gate.technical ? gate.technical.outcome : "not_run",
      gate.security ? gate.security.outcome : "not_run",
      gate.requirements ? gate.requirements.outcome : "not_run"
    ].map(normalizeGateOutcome)
    if (outcomes.indexOf("fail") !== -1) return "fail"
    if (outcomes.indexOf("not_run") !== -1) return "not_run"
    if (outcomes.every(function (o) { return o === "na" })) return "na"
    return "pass"
  }

  function normalizePhases(phases) {
    return (phases || []).map(function (p) {
      return {
        phase: String(p.phase || "—"),
        command: p.command || null,
        outcome: normalizeGateOutcome(p.outcome),
        detail: p.detail || "",
        reason: p.reason || ""
      }
    })
  }

  function normalizeGate(raw, cardId) {
    var gate = raw || {}
    var technical = normalizePhases(gate.technical)
    var security = normalizePhases(gate.security)
    var requirements = normalizePhases(gate.requirements)
    return {
      cardId: cardId,
      ranAt: gate.ranAt || null,
      text: gate.text || "",
      technical: { outcome: normalizeGateOutcome(gate.technicalOutcome), phases: technical },
      security: { outcome: normalizeGateOutcome(gate.securityOutcome), phases: security },
      requirements: { outcome: normalizeGateOutcome(gate.requirementsOutcome), phases: requirements },
      verdict: normalizeGateOutcome(gate.verdict)
    }
  }

  function normalizeAcceptance(list, nodes) {
    var evidence = nodes || []
    return (list || []).map(function (text, index) {
      var linked = evidence.filter(function (n) {
        if (!n) return false
        if (typeof n.requirementIndex === "number" && n.requirementIndex >= 0) return n.requirementIndex === index
        return n.requirement === text
      })
      var passed = linked.filter(function (n) { return n.passed !== false })
      return {
        index: index,
        text: text,
        evidence: linked,
        satisfied: passed.length > 0,
        failed: linked.some(function (n) { return n.passed === false })
      }
    })
  }

  /** Progreso del checklist: criterios con evidencia viva sobre total. */
  function acceptanceProgress(card) {
    var list = (card && card.acceptance) || []
    var covered = list.filter(function (a) { return a.satisfied }).length
    return {
      total: list.length,
      covered: covered,
      missing: list.length - covered,
      pct: percent(covered, list.length)
    }
  }

  function artifactBase(rawPath, cardId) {
    var text = String(rawPath || "").replace(/\\/g, "/")
    if (!text) return "../.oficina/artifacts/" + cardId
    if (/^\.oficina\//.test(text)) return "../" + text
    return text
  }

  function normalizeCard(raw, ctx) {
    var context = ctx || {}
    var agents = context.agents || {}
    var gates = context.gates || {}
    var evidence = context.evidence || {}
    var id = String(raw.id || "")
    var owner = normalizeAgent(agents[raw.owner]) || (raw.owner ? {
      id: raw.owner, name: raw.owner, role: "", initials: initials(raw.owner), hue: hueFor(raw.owner), state: null, currentCard: null
    } : null)
    var reviewer = normalizeAgent(agents[raw.reviewer]) || (raw.reviewer ? {
      id: raw.reviewer, name: raw.reviewer, role: "", initials: initials(raw.reviewer), hue: hueFor(raw.reviewer), state: null, currentCard: null
    } : null)
    var gate = normalizeGate(gates[id] || {}, id)
    gate.text = raw.gate || ""
    var state = COLUMN_IDS.indexOf(raw.state) === -1 ? "todo" : raw.state
    var acceptance = normalizeAcceptance(raw.acceptance, evidence[id])
    // El gate de requisitos no vive en gates.md: se deriva del grafo de
    // evidencia. Un criterio sin evidencia deja el gate en NOT_RUN, no en PASS.
    gate.requirements.outcome = requirementsOutcome(acceptance)
    gate.requirements.phases = acceptance.map(function (item) {
      return {
        phase: "criterio " + (item.index + 1),
        command: null,
        outcome: item.failed ? "fail" : item.satisfied ? "pass" : "not_run",
        detail: item.text.length > 120 ? item.text.slice(0, 117) + "…" : item.text,
        reason: ""
      }
    })
    return {
      id: id,
      title: raw.title || "(sin título)",
      type: raw.type || "—",
      state: state,
      rawState: raw.state || state,
      owner: owner,
      reviewer: reviewer,
      rejections: Number(raw.rejections || 0),
      attempts: Number(raw.attempts || 0),
      acceptance: acceptance,
      gate: gate,
      gateText: raw.gate || "",
      gateOutcome: gateOutcome(gate),
      scope: {
        mayTouch: (raw.scope && raw.scope.mayTouch) || [],
        forbidden: (raw.scope && raw.scope.forbidden) || []
      },
      artifactsUrl: artifactBase(raw.artifacts, id),
      artifactsRaw: raw.artifacts || "",
      result: raw.result || null,
      dependsOn: raw.dependsOn || [],
      helpHops: Number(raw.helpHops || 0),
      helpRequests: raw.helpRequests || []
    }
  }

  function normalizeDataset(input) {
    var data = input || {}
    var agents = {}
    var rawAgents = data.agents || {}
    Object.keys(rawAgents).forEach(function (key) {
      var agent = normalizeAgent(rawAgents[key])
      if (agent) agents[agent.id] = agent
    })
    var ctx = { agents: agents, gates: data.gates || {}, evidence: data.evidence || {} }
    var cards = (data.cards || []).map(function (raw) { return normalizeCard(raw, ctx) })
    return {
      meta: data.meta || {},
      agents: agents,
      cards: cards,
      columns: COLUMNS.map(function (column) {
        return { id: column.id, label: column.label, hint: column.hint }
      })
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Filtros y agrupación
  // ───────────────────────────────────────────────────────────────────────

  function matchesFilters(card, filters) {
    var f = filters || {}
    if (f.owner && f.owner !== "all") {
      if (f.owner === "unassigned") {
        if (card.owner) return false
      } else if (!card.owner || card.owner.id !== f.owner) {
        return false
      }
    }
    if (f.type && f.type !== "all" && card.type !== f.type) return false
    if (f.state && f.state !== "all" && card.state !== f.state) return false
    if (f.q) {
      var needle = String(f.q).toLowerCase()
      var haystack = (card.id + " " + card.title + " " + card.type + " " + (card.owner ? card.owner.id : "")).toLowerCase()
      if (haystack.indexOf(needle) === -1) return false
    }
    return true
  }

  function filterCards(cards, filters) {
    return (cards || []).filter(function (card) { return matchesFilters(card, filters) })
  }

  /** Agrupa por columna. Siempre devuelve las 7 claves, aun vacías. */
  function groupByColumn(cards) {
    var groups = {}
    COLUMN_IDS.forEach(function (id) { groups[id] = [] })
    ;(cards || []).forEach(function (card) {
      var key = COLUMN_IDS.indexOf(card.state) === -1 ? "todo" : card.state
      groups[key].push(card)
    })
    COLUMN_IDS.forEach(function (id) {
      groups[id].sort(function (a, b) {
        var na = parseInt(String(a.id).replace(/\D+/g, ""), 10)
        var nb = parseInt(String(b.id).replace(/\D+/g, ""), 10)
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
        return String(a.id).localeCompare(String(b.id))
      })
    })
    return groups
  }

  function columnCounts(cards) {
    var groups = groupByColumn(cards)
    var counts = {}
    COLUMN_IDS.forEach(function (id) { counts[id] = groups[id].length })
    return counts
  }

  // ───────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────

  function avatarHtml(agent, extraClass) {
    var classes = "avatar" + (extraClass ? " " + extraClass : "")
    if (!agent) {
      return '<span class="' + classes + ' avatar--empty" aria-hidden="true">?</span>'
    }
    return (
      '<span class="' + classes + '" style="--avatar-hue:' + agent.hue + '" title="' +
      escapeHtml(agent.name + (agent.role ? " · " + agent.role : "")) + '" data-agent-id="' + escapeHtml(agent.id) + '">' +
      escapeHtml(agent.initials) + "</span>"
    )
  }

  function gateBadgeHtml(label, outcome) {
    var badge = gateBadge(outcome)
    return (
      '<span class="' + badge.className + '" data-outcome="' + badge.outcome + '" title="' +
      escapeHtml(label + ": " + badge.label) + '"><span class="gate-key">' + escapeHtml(label) + '</span> ' +
      escapeHtml(badge.label) + "</span>"
    )
  }

  function cardHtml(card) {
    var progress = acceptanceProgress(card)
    var visible = card.acceptance.slice(0, 3)
    var hidden = Math.max(0, card.acceptance.length - visible.length)
    var ownerHtml = card.owner
      ? '<span class="person person--owner" data-owner="' + escapeHtml(card.owner.id) + '">' +
        avatarHtml(card.owner) + '<span class="person-name">' + escapeHtml(card.owner.name) + "</span></span>"
      : '<span class="person person--owner person--unassigned" data-owner="">' +
        avatarHtml(null) + '<span class="person-name">sin asignar</span></span>'
    var reviewerHtml = card.reviewer
      ? '<span class="person person--reviewer" data-reviewer="' + escapeHtml(card.reviewer.id) + '">' +
        avatarHtml(card.reviewer) + '<span class="person-name">' + escapeHtml(card.reviewer.name) + "</span></span>"
      : '<span class="person person--reviewer person--unassigned" data-reviewer="">' +
        avatarHtml(null) + '<span class="person-name">sin revisor</span></span>'

    var checklist = visible.map(function (item) {
      return (
        '<li class="check-item ' + (item.satisfied ? "is-checked" : item.failed ? "is-failed" : "is-empty") + '">' +
        '<span class="check-box" aria-hidden="true">' + (item.satisfied ? "✓" : item.failed ? "!" : "·") + "</span>" +
        '<span class="check-text">' + escapeHtml(item.text) + "</span></li>"
      )
    }).join("")

    return (
      '<article class="card" data-card-id="' + escapeHtml(card.id) + '" data-state="' + escapeHtml(card.state) +
      '" data-type="' + escapeHtml(card.type) + '" draggable="true" tabindex="0" role="button" aria-haspopup="dialog"' +
      ' aria-label="' + escapeHtml(card.id + " · " + card.title) + '">' +
      '<header class="card-top"><span class="card-id">' + escapeHtml(card.id) + "</span>" +
      '<span class="badge badge--type">' + escapeHtml(card.type) + "</span></header>" +
      '<h3 class="card-title">' + escapeHtml(card.title) + "</h3>" +
      '<div class="card-people">' + ownerHtml + reviewerHtml +
      '<span class="rejections" data-rejections="' + card.rejections + '" title="Rechazos del revisor">' +
      '<span class="rejections-mark" aria-hidden="true">↺</span> ' + card.rejections + "</span></div>" +
      (card.acceptance.length
        ? '<ul class="checklist" aria-label="Criterios de aceptación">' + checklist +
          (hidden > 0 ? '<li class="check-more">+' + hidden + " criterio" + (hidden === 1 ? "" : "s") + " más</li>" : "") +
          '<li class="check-progress"><span class="check-progress-label">' + progress.covered + "/" + progress.total +
          ' con evidencia</span><span class="check-progress-track" aria-hidden="true"><span class="check-progress-fill" style="width:' +
          progress.pct + '%"></span></span></li></ul>'
        : '<p class="checklist-empty">sin criterios declarados</p>') +
      '<footer class="card-gates">' +
      gateBadgeHtml("TEC", card.gate.technical.outcome) +
      gateBadgeHtml("SEC", card.gate.security.outcome) +
      gateBadgeHtml("REQ", card.gate.requirements.outcome) +
      "</footer></article>"
    )
  }

  function emptyColumnHtml(column) {
    return (
      '<p class="column-empty">nada en <strong>' + escapeHtml(column.label) + "</strong>" +
      (column.hint ? ' <span class="column-hint">(' + escapeHtml(column.hint) + ")</span>" : "") + "</p>"
    )
  }

  function columnBodyHtml(column, cards) {
    if (!cards.length) return emptyColumnHtml(column)
    return cards.map(cardHtml).join("")
  }

  /**
   * HTML interno de cada columna, indexado por id (no incluye el shell
   * estático: el `<section>` de cada columna vive en el HTML para que la
   * grilla exista aun sin JS).
   */
  function boardHtml(view, filters) {
    var visible = filterCards(view.cards, filters)
    var groups = groupByColumn(visible)
    var result = {}
    COLUMN_IDS.forEach(function (id) {
      var column = COLUMNS.filter(function (c) { return c.id === id })[0]
      result[id] = columnBodyHtml(column, groups[id])
    })
    return result
  }

  function evidenceLinksHtml(card) {
    var nodes = []
    card.acceptance.forEach(function (item) {
      item.evidence.forEach(function (node) { nodes.push({ item: item, node: node }) })
    })
    if (nodes.length === 0) return '<p class="detail-empty">Sin evidencia registrada en .oficina/evidence/.</p>'
    return (
      '<ul class="detail-list">' +
      nodes.map(function (entry) {
        var node = entry.node
        var href = ""
        if (node.kind === "artifact" && node.ref) {
          href = card.artifactsUrl + "/" + String(node.ref).replace(/^.*[\\/]/, "")
          href = '<a class="artifact-link" href="' + escapeHtml(href) + '">' + escapeHtml(node.ref) + "</a>"
        } else {
          href = '<code class="evidence-ref">' + escapeHtml(node.ref || "—") + "</code>"
        }
        var mark = node.passed === false ? "fail" : "pass"
        return (
          '<li class="evidence-item" data-evidence-kind="' + escapeHtml(node.kind || "—") +
          '" data-evidence-passed="' + String(node.passed !== false) + '">' +
          '<span class="gate-badge gate-badge--' + mark + '">' + (mark === "pass" ? "PASS" : "FAIL") + "</span> " +
          href +
          '<span class="evidence-meta">' + escapeHtml(node.kind || "—") + " · nivel " + escapeHtml(node.level || "—") +
          " · " + escapeHtml(node.recordedBy || "—") + "</span>" +
          (node.note ? '<p class="evidence-note">' + escapeHtml(node.note) + "</p>" : "") +
          '<p class="evidence-req">' + escapeHtml(entry.item.text) + "</p></li>"
        )
      }).join("") +
      "</ul>"
    )
  }

  function acceptanceDetailHtml(card) {
    if (!card.acceptance.length) return '<p class="detail-empty">La card no declara criterios de aceptación.</p>'
    return (
      '<ol class="detail-acceptance">' +
      card.acceptance.map(function (item) {
        var state = item.satisfied ? "pass" : item.failed ? "fail" : "not_run"
        var evidence = item.evidence.length
          ? item.evidence.map(function (node) {
              return '<li class="acceptance-evidence"><code>' + escapeHtml(node.ref || "—") + "</code>" +
                '<span class="evidence-meta">' + escapeHtml(node.kind || "—") + " · nivel " + escapeHtml(node.level || "—") + "</span></li>"
            }).join("")
          : '<li class="acceptance-evidence detail-empty">sin evidencia</li>'
        return (
          '<li class="acceptance-item" data-acceptance-index="' + item.index + '" data-acceptance-state="' + state + '">' +
          '<span class="gate-badge gate-badge--' + state.replace(/_/g, "-") + '">' + escapeHtml(GATE_LABELS[state] || "—") + "</span>" +
          '<p class="acceptance-text">' + escapeHtml(item.text) + "</p>" +
          '<ul class="acceptance-evidence-list">' + evidence + "</ul></li>"
        )
      }).join("") +
      "</ol>"
    )
  }

  function gateSectionHtml(gate) {
    var sections = [
      { key: "technical", label: "Técnico" },
      { key: "security", label: "Seguridad" },
      { key: "requirements", label: "Requisitos" }
    ]
    return sections.map(function (section) {
      var data = gate[section.key]
      var phases = data.phases || []
      var rows = phases.length
        ? phases.map(function (phase) {
            return (
              "<tr><td>" + escapeHtml(phase.phase) + "</td><td><code>" + escapeHtml(phase.command || "—") + "</code></td>" +
              "<td>" + gateBadgeHtml("", phase.outcome) + "</td><td>" + escapeHtml(phase.detail || "—") +
              (phase.reason ? '<p class="phase-reason">' + escapeHtml(phase.reason) + "</p>" : "") + "</td></tr>"
            )
          }).join("")
        : '<tr><td colspan="4" class="detail-empty">Sin registro de fases para este bloque (gates.md ausente o vacío).</td></tr>'
      return (
        '<div class="gate-block" data-gate-section="' + section.key + '">' +
        '<h4 class="gate-block-title">' + escapeHtml(section.label) + " " + gateBadgeHtml("", data.outcome) + "</h4>" +
        '<table class="gate-table"><thead><tr><th>Fase</th><th>Comando</th><th>Estado</th><th>Detalle</th></tr></thead>' +
        "<tbody>" + rows + "</tbody></table></div>"
      )
    }).join("")
  }

  function scopeListHtml(label, items, tone) {
    return (
      '<div class="scope-block scope-block--' + tone + '"><h4>' + escapeHtml(label) + "</h4>" +
      (items.length
        ? '<ul class="scope-list">' + items.map(function (item) {
            return '<li><code>' + escapeHtml(item) + "</code></li>"
          }).join("") + "</ul>"
        : '<p class="detail-empty">—</p>') +
      "</div>"
    )
  }

  function modalHtml(card) {
    var progress = acceptanceProgress(card)
    var artifacts = [
      { label: "handoff.md", href: card.artifactsUrl + "/handoff.md" },
      { label: "evidence.md", href: card.artifactsUrl + "/evidence.md" },
      { label: "gates.md", href: card.artifactsUrl + "/gates.md" }
    ]
    return (
      '<header class="modal-head">' +
      '<div class="modal-ident"><span class="card-id">' + escapeHtml(card.id) + "</span>" +
      '<span class="badge badge--state" data-state="' + escapeHtml(card.state) + '">' + escapeHtml(card.state.toUpperCase()) + "</span>" +
      '<span class="badge badge--type">' + escapeHtml(card.type) + "</span></div>" +
      "<h2 id=\"card-modal-title\" class=\"modal-title\">" + escapeHtml(card.title) + "</h2>" +
      '<p class="modal-meta">intentos ' + card.attempts + " · rechazos " + card.rejections +
      " · evidencia " + progress.covered + "/" + progress.total +
      (card.gate.ranAt ? " · gates corridos " + escapeHtml(formatRelative(card.gate.ranAt)) : " · gates sin correr") +
      "</p></header>" +
      '<div class="modal-body">' +
      '<section class="detail-section" data-detail="scope"><h3>Scope</h3>' +
      scopeListHtml("Puede tocar", card.scope.mayTouch, "may") +
      scopeListHtml("Prohibido", card.scope.forbidden, "forbidden") +
      (card.dependsOn.length
        ? '<p class="detail-meta">Depende de: ' + card.dependsOn.map(function (d) {
            return '<span class="chip">' + escapeHtml(d) + "</span>"
          }).join(" ") + "</p>"
        : "") +
      "</section>" +
      '<section class="detail-section" data-detail="acceptance"><h3>Criterios de aceptación <span class="detail-count">' +
      progress.covered + "/" + progress.total + "</span></h3>" + acceptanceDetailHtml(card) + "</section>" +
      '<section class="detail-section" data-detail="gate"><h3>Gate</h3>' +
      '<p class="detail-gate-text"><code>' + escapeHtml(card.gateText || "sin condición declarada") + "</code></p>" +
      gateSectionHtml(card.gate) + "</section>" +
      '<section class="detail-section" data-detail="artifacts"><h3>Artifacts</h3>' +
      '<ul class="artifact-list">' + artifacts.map(function (a) {
        return '<li><a class="artifact-link" href="' + escapeHtml(a.href) + '">' + escapeHtml(a.label) + "</a></li>"
      }).join("") +
      '<li><code class="artifact-path">' + escapeHtml(card.artifactsRaw || card.artifactsUrl) + "</code></li></ul>" +
      (card.result ? '<p class="detail-result">' + escapeHtml(card.result) + "</p>" : "") +
      "</section>" +
      '<section class="detail-section" data-detail="evidence"><h3>Evidence</h3>' + evidenceLinksHtml(card) + "</section>" +
      "</div>"
    )
  }

  // ───────────────────────────────────────────────────────────────────────
  // Export
  // ───────────────────────────────────────────────────────────────────────

  var api = {
    COLUMNS: COLUMNS,
    COLUMN_IDS: COLUMN_IDS,
    GATE_LABELS: GATE_LABELS,
    escapeHtml: escapeHtml,
    initials: initials,
    hueFor: hueFor,
    percent: percent,
    formatRelative: formatRelative,
    normalizeAgent: normalizeAgent,
    normalizeCard: normalizeCard,
    normalizeDataset: normalizeDataset,
    normalizeGateOutcome: normalizeGateOutcome,
    requirementsOutcome: requirementsOutcome,
    gateOutcome: gateOutcome,
    gateBadge: gateBadge,
    acceptanceProgress: acceptanceProgress,
    matchesFilters: matchesFilters,
    filterCards: filterCards,
    groupByColumn: groupByColumn,
    columnCounts: columnCounts,
    cardHtml: cardHtml,
    columnBodyHtml: columnBodyHtml,
    boardHtml: boardHtml,
    avatarHtml: avatarHtml,
    gateBadgeHtml: gateBadgeHtml,
    acceptanceDetailHtml: acceptanceDetailHtml,
    evidenceLinksHtml: evidenceLinksHtml,
    gateSectionHtml: gateSectionHtml,
    modalHtml: modalHtml
  }

  global.KanbanSource = api
  if (typeof module !== "undefined" && module.exports) module.exports = api
})(typeof globalThis !== "undefined" ? globalThis : this)
