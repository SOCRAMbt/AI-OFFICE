/* ==========================================================================
   dashboard/factory.html — app layer (classic script, no build step)
   Depends on: globalThis.FactoryCore (dashboard/factory/factory-core.js)
   Data:  live  -> /api/snapshot            (dashboard/serve.mjs)
          static-> ../.oficina/*.json      (any static server at repo root)
          offline-> window.__FACTORY_SNAPSHOT__ (dashboard/factory/snapshot.js)
   The panel is strictly read-only: "registering" an agent is a local
   projection so the animation can be watched without faking a disk write.
   ========================================================================== */

;(function factoryApp() {
  "use strict"

  var Core = globalThis.FactoryCore
  var doc = document
  var root = doc.documentElement

  if (!Core) {
    doc.body.insertAdjacentHTML(
      "afterbegin",
      '<p style="padding:2rem;font-family:monospace;color:#f88">' +
        "factory-core.js no cargó: revisá la ruta del script.</p>",
    )
    return
  }

  // ---------------------------------------------------------------- helpers
  var $ = function (sel, ctx) {
    return (ctx || doc).querySelector(sel)
  }
  var $$ = function (sel, ctx) {
    return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel))
  }
  var sleep = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }
  var esc = function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  }
  var reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches
  var clamp = function (n, min, max) {
    return Math.max(min, Math.min(max, n))
  }
  var initials = function (name) {
    var words = String(name || "?")
      .replace(/[^A-Za-z0-9áéíóúñ ]/gi, " ")
      .split(/\s+/)
      .filter(Boolean)
    if (words.length === 0) return "??"
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
    return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  }
  var timeOf = function (iso) {
    var date = iso ? new Date(iso) : new Date()
    if (isNaN(date.getTime())) return "--:--:--"
    return date.toLocaleTimeString("es-AR", { hour12: false })
  }
  var STORAGE_THEME = "oficina.factory.theme"

  // ---------------------------------------------------------------- elements
  var els = {
    sourceChip: $("#source-chip"),
    sourceText: $("#source-text"),
    pollChip: $("#poll-chip"),
    clockChip: $("#clock-chip"),
    countsChip: $("#counts-chip"),
    btnFabricate: $("#btn-fabricate"),
    btnPause: $("#btn-pause"),
    btnResync: $("#btn-resync"),
    btnTheme: $("#btn-theme"),
    fabricateHint: $("#fabricate-hint"),
    coverageValue: $("#coverage-value"),
    coverageFill: $("#coverage-fill"),
    coverageThreshold: $("#coverage-threshold"),
    coverageNote: $("#coverage-note"),
    gapList: $("#gap-list"),
    gapCount: $("#gap-count"),
    stage: $("#stage"),
    sceneMoldLabel: $("#scene-mold-label"),
    sceneAgent: $("#scene-agent"),
    sceneOutLabel: $("#scene-out-label"),
    steps: $$("#steps .step"),
    termPath: $("#term-path"),
    termPathText: $("#term-path-text"),
    termTag: $("#term-tag"),
    termBody: $("#term-body"),
    rosterGrid: $("#roster-grid"),
    rosterCount: $("#roster-count"),
    matchBody: $("#match-body"),
    matchCount: $("#match-count"),
    toasts: $("#toasts"),
    dialog: $("#agent-dialog"),
    dialogAvatar: $("#dialog-avatar"),
    dialogTitle: $("#dialog-title"),
    dialogSub: $("#dialog-sub"),
    dialogMeta: $("#dialog-meta"),
    dialogBody: $("#dialog-body"),
    dialogOrigin: $("#dialog-origin"),
    btnCopy: $("#btn-copy"),
    live: $("#live-region"),
  }

  // ---------------------------------------------------------------- state
  var app = {
    snapshot: null,
    sourceKind: "none",
    need: null,
    focusId: null,
    preview: null,
    fabricated: null,
    projection: null,
    running: false,
    runToken: 0,
    paused: false,
    tick: 0,
    interval: 800,
    unchanged: 0,
    lastSignature: "",
    startedAt: null,
    confirmed: false,
    fichaOrigin: "proyectada",
    pendingAuto: false,
  }

  var STEPS = [
    { id: "detect", label: "Detectar hueco de cobertura", end: "GAP" },
    { id: "synthesize", label: "Sintetizar rol y capabilities", end: "ROL" },
    { id: "write", label: "Escribir la ficha .md", end: "FICHA" },
    { id: "register", label: "Registrar en el catálogo dinámico", end: "ROSTER" },
    { id: "match", label: "Match en la próxima card", end: "MATCH" },
  ]

  // ---------------------------------------------------------------- announce
  function announce(message) {
    if (!els.live) return
    els.live.textContent = ""
    // force SR re-announcement for identical strings
    setTimeout(function () {
      els.live.textContent = message
    }, 30)
  }

  // ---------------------------------------------------------------- data
  async function fetchJson(url) {
    var response = await fetch(url, { cache: "no-store" })
    if (!response.ok) throw new Error(url + " -> " + response.status)
    return response.json()
  }

  async function loadFromApi() {
    var data = await fetchJson("/api/snapshot")
    if (!data || !data.state || !data.roster) throw new Error("payload inválido")
    return {
      source: "live",
      capturedAt: data.capturedAt,
      state: data.state,
      roster: data.roster,
      catalogo: data.catalogo || [],
      fichas: data.fichas || {},
    }
  }

  async function loadFromFiles() {
    var pair = await Promise.all([
      fetchJson("../.oficina/state.json"),
      fetchJson("../.oficina/roster.json"),
    ])
    return {
      source: "static",
      capturedAt: new Date().toISOString(),
      state: pair[0],
      roster: pair[1],
      catalogo: [],
      fichas: {},
    }
  }

  function loadFromEmbedded() {
    var snap = window.__FACTORY_SNAPSHOT__
    if (!snap || !snap.state || !snap.roster) throw new Error("sin snapshot embebido")
    return {
      source: "snapshot",
      capturedAt: snap.capturedAt,
      state: snap.state,
      roster: snap.roster,
      catalogo: snap.catalogo || [],
      fichas: snap.fichas || {},
    }
  }

  async function acquireData() {
    var errors = []
    var loaders = [
      ["live", loadFromApi],
      ["static", loadFromFiles],
      ["snapshot", loadFromEmbedded],
    ]
    for (var i = 0; i < loaders.length; i += 1) {
      try {
        return await loaders[i][1]()
      } catch (error) {
        errors.push(loaders[i][0] + ": " + error.message)
      }
    }
    throw new Error("sin fuente de datos — " + errors.join(" · "))
  }

  function signatureOf(data) {
    var rosterUpdated = (data.roster && data.roster.updatedAt) || ""
    var stateUpdated = (data.state && data.state.updatedAt) || ""
    var cards = Object.keys((data.state && data.state.cards) || {}).length
    var agents = Object.keys((data.roster && data.roster.agents) || {}).length
    return [rosterUpdated, stateUpdated, cards, agents].join("|")
  }

  /**
   * Merge the local projection into the real roster so the UI can show the
   * fabricated agent without pretending roster.json changed on disk.
   */
  function effectiveRoster() {
    if (!app.snapshot) return { agents: {} }
    if (!app.fabricated) return app.snapshot.roster
    return Core.registerAgent(app.snapshot.roster, app.fabricated, {
      now: app.fabricated.fabricatedAt,
      cardTitle: cardById(app.fabricated.fabricatedFor)
        ? cardById(app.fabricated.fabricatedFor).title
        : null,
    })
  }

  function cardById(id) {
    if (!app.snapshot) return null
    return (
      Core.parseCards(app.snapshot.state).filter(function (card) {
        return card.id === id
      })[0] || null
    )
  }

  // ---------------------------------------------------------------- sync
  async function sync(options) {
    var opts = options || {}
    if (app.running) return
    try {
      var data = await acquireData()
      var signature = signatureOf(data)
      var changed = signature !== app.lastSignature
      app.snapshot = data
      app.sourceKind = data.source
      app.lastSignature = signature
      app.startedAt = data.capturedAt || new Date().toISOString()

      // Confirm a projection that actually landed in roster.json.
      if (
        app.fabricated &&
        data.roster &&
        data.roster.agents &&
        data.roster.agents[app.fabricated.id]
      ) {
        app.confirmed = true
      }

      recompute()
      renderAll()
      setSourceChip(data.source)
      els.clockChip.textContent = "sync " + timeOf(app.startedAt)
      els.clockChip.title = "última lectura: " + app.startedAt

      if (changed) {
        app.unchanged = 0
        app.interval = 800
      } else {
        app.unchanged += 1
        if (app.unchanged > 8) app.interval = clamp(Math.round(app.interval * 1.5), 800, 4000)
      }
      els.pollChip.textContent = "poll " + app.interval + "ms"
      if (opts.manual) announce("Datos sincronizados desde " + data.source + ".")
    } catch (error) {
      app.sourceKind = "error"
      setSourceChip("error")
      els.clockChip.textContent = "sin datos"
      if (opts.manual) announce("No se pudo leer .oficina/: " + error.message)
      console.error("[factory]", error)
    }
  }

  function setSourceChip(kind) {
    var labels = {
      live: "LIVE · api",
      static: "STATIC · http",
      snapshot: "OFFLINE · snapshot",
      error: "SIN DATOS",
    }
    els.sourceChip.setAttribute("data-live", kind)
    els.sourceText.textContent = labels[kind] || kind
    els.sourceChip.title =
      kind === "live"
        ? "leyendo .oficina/ vía dashboard/serve.mjs"
        : kind === "static"
          ? "leyendo ../.oficina/*.json por HTTP"
          : kind === "snapshot"
            ? "snapshot embebido: regeneralo con node dashboard/factory/build-snapshot.mjs"
            : "no se pudo leer .oficina/"
  }

  // ---------------------------------------------------------------- compute
  function recompute() {
    if (!app.snapshot) return
    var roster = effectiveRoster()
    app.need = Core.detectFactoryNeed(app.snapshot.state, roster, {
      threshold: Core.COVERAGE_THRESHOLD,
    })
    app.preview = buildPreview()
  }

  function focusGap() {
    if (!app.need) return null
    var gaps = app.need.gaps
    var chosen = gaps.filter(function (gap) {
      return gap.cardId === app.focusId
    })[0]
    if (chosen) return chosen
    var working = gaps.filter(function (gap) {
      return gap.state === "in_progress"
    })[0]
    return working || gaps[0] || null
  }

  function buildPreview() {
    var gap = focusGap()
    if (!gap) return null
    var card = cardById(gap.cardId)
    if (!card) return null
    var agent = Core.synthesizeAgent(card, app.need.agents)
    var projection = Core.projectMatch(app.snapshot.state, effectiveRoster(), {
      fabricated: agent,
      threshold: Core.COVERAGE_THRESHOLD,
    })
    var self = projection.rows.filter(function (row) {
      return row.cardId === card.id
    })[0]
    var next = projection.nextMatch
    return {
      card: card,
      agent: agent,
      row: self,
      next: next,
      projection: projection,
    }
  }

  // ---------------------------------------------------------------- render
  function renderAll() {
    renderDetection()
    renderRoster()
    renderMatch()
    renderHero()
  }

  function renderHero() {
    var preview = app.preview
    var gaps = app.need ? app.need.gaps.length : 0
    els.countsChip.textContent =
      (app.need ? app.need.cardCount : 0) +
      " cards · " +
      (app.need ? app.need.agentCount : 0) +
      " agentes"

    if (app.running) return

    if (!preview) {
      els.btnFabricate.disabled = true
      els.btnFabricate.classList.remove("btn-armed")
      els.btnFabricate.querySelector(".btn-label").textContent =
        "Catálogo cubre el plan"
      els.fabricateHint.textContent =
        "Ninguna card abierta cae por debajo del umbral."
      els.sceneMoldLabel.textContent = "—"
      els.sceneAgent.textContent = "sin huecos"
      els.sceneOutLabel.textContent = "—"
      return
    }

    els.btnFabricate.disabled = false
    els.btnFabricate.classList.add("btn-armed")
    els.btnFabricate.querySelector(".btn-label").textContent =
      gaps > 1 ? "Fabricar agente (" + gaps + " huecos)" : "Fabricar agente"
    els.fabricateHint.textContent =
      preview.agent.displayName + " → " + preview.card.id + " · " + preview.card.title
    els.sceneMoldLabel.textContent = preview.card.id
    els.sceneAgent.textContent = app.fabricated
      ? app.fabricated.displayName
      : preview.agent.displayName
    els.sceneOutLabel.textContent = app.fabricated
      ? app.fabricated.id.replace(/^e-factory-/, "")
      : preview.agent.role
  }

  function renderDetection() {
    if (!app.need) return
    var need = app.need
    var pct = need.overallPct
    els.coverageValue.innerHTML = pct + "<small>%</small>"
    els.coverageFill.style.width = clamp(pct, 0, 100) + "%"
    els.coverageFill.setAttribute(
      "data-tone",
      pct >= need.thresholdPct ? "ok" : "bad",
    )
    els.coverageFill.parentElement.setAttribute("aria-valuenow", String(pct))
    els.coverageThreshold.style.left = need.thresholdPct + "%"
    els.coverageThreshold.setAttribute(
      "data-label",
      "umbral " + need.thresholdPct + "%",
    )
    els.gapCount.textContent = need.gaps.length + " gaps"
    els.coverageNote.textContent = app.fabricated
      ? "incluye 1 agente fabricado (proyección local)"
      : need.agentCount + " agentes en catálogo · " + need.cardCount + " cards"

    var gap = focusGap()
    if (gap && !app.focusId) app.focusId = gap.cardId

    if (need.gaps.length === 0) {
      els.gapList.innerHTML =
        '<div class="empty"><strong>Catálogo completo</strong>' +
        "Todas las cards abiertas superan el " +
        need.thresholdPct +
        "% de cobertura. La factory queda en espera.</div>"
      return
    }

    var html = need.gaps
      .map(function (item) {
        var missing = item.missing
        var chips = missing
          .slice(0, 4)
          .map(function (cap) {
            return '<span class="cap" data-kind="missing">' + esc(cap) + "</span>"
          })
          .join("")
        if (missing.length > 4) {
          chips += '<span class="cap">+' + (missing.length - 4) + "</span>"
        }
        if (missing.length === 0) {
          chips = '<span class="cap">sin requisitos</span>'
        }
        return (
          '<button type="button" class="gap-card" data-card="' +
          esc(item.cardId) +
          '" aria-pressed="' +
          (app.focusId === item.cardId ? "true" : "false") +
          '" aria-label="Card ' +
          esc(item.cardId) +
          ", cobertura " +
          item.pct +
          "%. " +
          esc(item.title) +
          '">' +
          '<span class="gap-top">' +
          '<span class="gap-id">' +
          esc(item.cardId) +
          "</span>" +
          '<span class="badge" data-state="' +
          esc(item.state) +
          '">' +
          esc(item.state) +
          "</span>" +
          (item.owner ? '<span class="cap">' + esc(item.owner) + "</span>" : "") +
          '<span class="gap-pct" data-tone="' +
          (item.pct >= need.thresholdPct ? "ok" : "bad") +
          '">' +
          item.pct +
          "%</span></span>" +
          '<span class="gap-title">' +
          esc(item.title) +
          "</span>" +
          '<span class="gap-missing">' +
          chips +
          "</span>" +
          "</button>"
        )
      })
      .join("")
    els.gapList.innerHTML = html

    $$(".gap-card", els.gapList).forEach(function (button) {
      button.addEventListener("click", function () {
        if (app.running) return
        selectCard(button.getAttribute("data-card"))
      })
    })
  }

  function selectCard(cardId) {
    if (!cardId || cardId === app.focusId) return
    app.focusId = cardId
    resetSequence()
    recompute()
    renderDetection()
    renderMatch()
    renderHero()
    announce("Card " + cardId + " seleccionada como objetivo de fabricación.")
  }

  function renderRoster(options) {
    var opts = options || {}
    var agents = Core.parseAgents(effectiveRoster())
    agents.sort(function (a, b) {
      var fabricatedA = a.source && a.source.kind === "factory" ? 0 : 1
      var fabricatedB = b.source && b.source.kind === "factory" ? 0 : 1
      if (fabricatedA !== fabricatedB) return fabricatedA - fabricatedB
      if (a.state !== b.state) return a.state === "working" ? -1 : 1
      return a.displayName.localeCompare(b.displayName)
    })

    els.rosterCount.textContent =
      agents.length + (app.fabricated ? " · proyección" : "")
    els.rosterGrid.innerHTML = agents
      .map(function (agent) {
        var fabricated = agent.source && agent.source.kind === "factory"
        return (
          '<button type="button" class="agent-chip" data-agent="' +
          esc(agent.id) +
          '" data-fabricated="' +
          (fabricated ? "true" : "false") +
          (opts.newId === agent.id ? '" data-new="true' : "") +
          '" aria-label="Abrir ficha de ' +
          esc(agent.displayName) +
          ", " +
          esc(agent.role) +
          '">' +
          '<span class="agent-avatar" aria-hidden="true">' +
          esc(initials(agent.displayName)) +
          "</span>" +
          '<span class="agent-main"><span class="agent-name">' +
          esc(agent.displayName) +
          '</span><span class="agent-role">' +
          esc(agent.role) +
          "</span></span>" +
          '<span class="agent-state" data-state="' +
          esc(agent.state) +
          '"><i></i>' +
          esc(agent.state.replace(/_/g, " ")) +
          "</span>" +
          "</button>"
        )
      })
      .join("")

    $$(".agent-chip[data-new]", els.rosterGrid).forEach(function (chip) {
      chip.classList.add("is-new")
    })

    $$(".agent-chip", els.rosterGrid).forEach(function (chip) {
      chip.addEventListener("click", function () {
        var agent = agents.filter(function (item) {
          return item.id === chip.getAttribute("data-agent")
        })[0]
        if (agent) openAgent(agent)
      })
    })
  }

  function renderMatch(options) {
    var opts = options || {}
    if (!app.preview) {
      els.matchBody.innerHTML =
        '<div class="empty">Sin proyección: el catálogo ya cubre las cards abiertas.</div>'
      els.matchCount.textContent = "0"
      return
    }
    var preview = app.preview
    var rows = []
    rows.push({ row: preview.row, label: "dispara", card: preview.card })
    if (preview.next && preview.next.cardId !== preview.card.id) {
      rows.push({ row: preview.next, label: "próxima card", card: null })
    }

    els.matchCount.textContent = rows.length + " cards"
    els.matchBody.innerHTML = rows
      .map(function (entry, index) {
        var row = entry.row
        var revealed = opts.revealed || app.fabricated
        var afterPct = revealed ? row.after.pct : row.before.pct
        var matched = revealed && row.after.covered
        return (
          '<div class="match-card" data-matched="' +
          (matched ? "true" : "false") +
          '">' +
          '<span class="match-stamp">MATCH</span>' +
          '<span class="match-id">' +
          esc(row.cardId) +
          '</span><span class="match-name">' +
          esc(entry.card ? entry.card.title : row.title) +
          "</span>" +
          '<div class="match-bars"><span>' +
          (index === 0 ? "actual" : "match") +
          '</span><div class="meter"><span class="meter-fill" data-tone="' +
          (row.before.covered ? "ok" : "bad") +
          '" style="width:' +
          row.before.pct +
          '%"></span></div><span class="match-value">' +
          row.before.pct +
          "%</span></div>" +
          '<div class="match-bars"><span>post</span><div class="meter">' +
          '<span class="meter-fill" data-tone="' +
          (row.after.covered ? "ok" : "bad") +
          '" style="width:' +
          afterPct +
          '%"></span></div><span class="match-value">' +
          afterPct +
          "%</span></div>" +
          "</div>"
        )
      })
      .join("")
  }

  // ---------------------------------------------------------------- steps
  function setStep(index, status, meta) {
    var step = els.steps[index]
    if (!step) return
    step.setAttribute("data-status", status)
    if (status === "active") step.setAttribute("aria-current", "step")
    else step.removeAttribute("aria-current")
    var icon = $(".step-icon", step)
    if (icon) {
      if (status === "done") icon.textContent = "✓"
      else if (status === "active") icon.textContent = "◆"
      else if (status === "skipped") icon.textContent = "–"
      else icon.textContent = String(index + 1).padStart(2, "0")
    }
    var end = $(".step-end", step)
    if (end) {
      end.textContent =
        status === "done"
          ? "ok"
          : status === "active"
            ? "run"
            : status === "skipped"
              ? "skip"
              : STEPS[index].end
    }
    if (meta != null) {
      var metaEl = $(".step-meta", step)
      if (metaEl) metaEl.textContent = meta
    }
  }

  function resetSequence() {
    app.runToken += 1
    app.running = false
    app.fabricated = null
    app.projection = null
    app.confirmed = false
    els.steps.forEach(function (_, index) {
      setStep(index, "pending", "")
    })
    setScene("idle")
    els.termPathText.textContent = "sin ficha en fabricación"
    els.termTag.textContent = "idle"
    els.termBody.innerHTML =
      '<span class="term-placeholder">La ficha .md se escribe acá cuando la factory sintetiza un agente.</span>'
    setStep(0, "pending", "esperando disparo")
  }

  function setScene(name) {
    els.stage.setAttribute("data-scene", name)
  }

  function kindOf(line) {
    if (/^#{1,2} /.test(line)) return "head"
    if (/^---$/.test(line)) return "front"
    if (/^(description|mode|capabilities):/.test(line)) return "front"
    if (/^#/.test(line)) return "dim"
    return ""
  }

  function scrollTerm() {
    els.termBody.scrollTop = els.termBody.scrollHeight
  }

  async function typeFicha(lines, token) {
    els.termBody.innerHTML = ""
    var cursor = doc.createElement("span")
    cursor.className = "cursor"
    cursor.setAttribute("aria-hidden", "true")
    var total = lines.length
    for (var i = 0; i < lines.length; i += 1) {
      if (token !== app.runToken) return
      var text = lines[i]
      var lineEl = doc.createElement("span")
      lineEl.className = "term-line"
      var kind = kindOf(text)
      if (kind) lineEl.setAttribute("data-kind", kind)
      lineEl.textContent = text || "\u00a0"
      els.termBody.appendChild(lineEl)
      els.termBody.appendChild(cursor)
      scrollTerm()
      setStep(2, "active", "escribiendo " + (i + 1) + "/" + total + " líneas")
      if (!reducedMotion && text.length > 0) {
        var perTick = Math.max(2, Math.ceil(text.length / 60))
        for (var pos = perTick; pos < text.length; pos += perTick) {
          if (token !== app.runToken) return
          lineEl.textContent = text.slice(0, pos)
          scrollTerm()
          await sleep(text.length > 70 ? 5 : 9)
        }
        lineEl.textContent = text
      }
      if (i % 3 === 0) {
        // yield so the UI can paint during long fichas
        await sleep(reducedMotion ? 0 : 12)
      }
    }
    if (token !== app.runToken) return
    setStep(2, "done", total + " líneas · " + app.fabricated.fichaPath)
    els.termTag.textContent = "escrita"
  }

  // ---------------------------------------------------------------- fabricate
  async function fabricate(cardId) {
    if (app.running || !app.preview) return
    var token = ++app.runToken
    var preview = app.preview
    var card = preview.card
    var agent = Core.synthesizeAgent(card, app.need.agents, {
      now: new Date().toISOString(),
    })
    var projection = Core.projectMatch(app.snapshot.state, effectiveRoster(), {
      fabricated: agent,
      threshold: Core.COVERAGE_THRESHOLD,
    })
    var speed = reducedMotion ? 0.05 : 1
    var wait = function (ms) {
      return sleep(ms * speed)
    }

    app.running = true
    app.fabricated = agent
    app.projection = projection
    app.confirmed = false
    els.btnFabricate.disabled = true
    els.fabricateHint.textContent = "fabricando " + agent.id + "…"
    els.sceneMoldLabel.textContent = card.id
    els.sceneAgent.textContent = agent.displayName
    els.sceneOutLabel.textContent = agent.role
    els.steps.forEach(function (_, index) {
      setStep(index, "pending", "")
    })

    // 1 · detection
    setScene("detect")
    setStep(0, "active", "cobertura " + preview.row.before.pct + "% < 60% · " + card.id)
    announce("Factory detectó cobertura insuficiente en " + card.id + ".")
    await wait(620)
    if (token !== app.runToken) return
    setStep(0, "done", card.id + " · " + preview.row.before.pct + "% · faltan " + preview.row.before.missing.length)

    // 2 · synthesize
    setScene("synthesize")
    setStep(1, "active", "rol: " + agent.role)
    await wait(780)
    if (token !== app.runToken) return
    setStep(1, "done", agent.capabilities.length + " capabilities · " + agent.id)

    // 3 · write the ficha
    setScene("write")
    els.termPathText.textContent = agent.fichaPath
    els.termTag.textContent = "escribiendo"
    els.termPath.title = agent.fichaPath
    var lines = Core.renderFichaLines(agent, card)
    var dirLine = "# oficina factory --card " + card.id + " --role " + agent.role
    await typeFicha([dirLine].concat(lines), token)
    if (token !== app.runToken) return

    // 4 · register in the catalog
    setScene("register")
    setStep(3, "active", "roster.json ← " + agent.id)
    renderRoster({ newId: agent.id })
    announce(agent.displayName + " registrado en el catálogo.")
    await wait(760)
    if (token !== app.runToken) return
    setStep(3, "done", (app.need.agentCount + 1) + " agentes en catálogo")

    // 5 · next card matches
    setScene("match")
    setStep(4, "active", "recalculando cobertura…")
    recompute()
    renderDetection()
    renderMatch({ revealed: true })
    await wait(760)
    if (token !== app.runToken) return
    var next = projection.nextMatch
    setStep(
      4,
      "done",
      next
        ? next.cardId + " · " + next.before.pct + "% → " + next.after.pct + "%"
        : card.id + " · " + preview.row.before.pct + "% → " + preview.row.after.pct + "%",
    )

    setScene("done")
    app.running = false
    els.termTag.textContent = "lista"
    renderHero()
    showToast(agent, { next: next, card: card })
    announce(
      "Factory completa: " +
        agent.displayName +
        " fabricado y agregado al roster. Click en la notificación para abrir su ficha.",
    )
  }

  // ---------------------------------------------------------------- toasts
  var toastTimers = []

  function showToast(agent, options) {
    var opts = options || {}
    var next = opts.next
    var toast = doc.createElement("div")
    toast.className = "toast"
    toast.setAttribute("role", "group")
    toast.setAttribute("aria-label", "Factory completa: " + agent.displayName)

    var detail = next
      ? "match en " + next.cardId + " · " + next.before.pct + "% → " + next.after.pct + "%"
      : "registrado en el roster"

    toast.innerHTML =
      '<button type="button" class="toast-open">' +
      '<span class="toast-kicker">factory · completa</span>' +
      '<span class="toast-name">' +
      esc(agent.displayName) +
      "</span>" +
      '<span class="toast-body">' +
      esc(detail) +
      "</span>" +
      '<span class="toast-cta">Abrir ficha <span aria-hidden="true">→</span></span>' +
      "</button>" +
      '<button type="button" class="toast-close" aria-label="Cerrar notificación">×</button>' +
      '<span class="toast-timer" aria-hidden="true"></span>'

    var dismiss = function () {
      if (toast.classList.contains("is-leaving")) return
      toast.classList.add("is-leaving")
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast)
      }, 240)
    }

    $(".toast-open", toast).addEventListener("click", function () {
      openAgent(agent)
      dismiss()
    })
    $(".toast-close", toast).addEventListener("click", dismiss)

    els.toasts.appendChild(toast)
    while (els.toasts.children.length > 3) {
      els.toasts.removeChild(els.toasts.firstChild)
    }
    var timer = setTimeout(dismiss, 12000)
    toastTimers.push(timer)
    toast.addEventListener("mouseenter", function () {
      clearTimeout(timer)
    })
    toast.addEventListener("focusin", function () {
      clearTimeout(timer)
    })
    announce("Notificación: " + agent.displayName + " listo. Enter para abrir su ficha.")
  }

  // ---------------------------------------------------------------- modal
  function toRepoRelative(path) {
    if (!path) return ""
    var normalized = String(path).replace(/\\/g, "/")
    var marker = normalized.indexOf(".opencode/")
    if (marker >= 0) return normalized.slice(marker)
    var agentMarker = normalized.indexOf("agents/")
    if (agentMarker >= 0) return ".opencode/" + normalized.slice(agentMarker)
    return normalized.replace(/^\.?\//, "")
  }

  async function resolveFicha(agent) {
    var rel = toRepoRelative(agent.fichaPath)
    var snap = app.snapshot
    if (snap && snap.fichas && rel && snap.fichas[rel]) {
      return { content: snap.fichas[rel].content, origin: "snapshot" }
    }
    if (app.sourceKind === "live" && rel) {
      try {
        var response = await fetch("/api/ficha?path=" + encodeURIComponent(rel), {
          cache: "no-store",
        })
        if (response.ok) {
          var data = await response.json()
          if (data && data.content) return { content: data.content, origin: "disco" }
        }
      } catch (error) {
        /* fall through */
      }
    }
    if (rel) {
      try {
        var raw = await fetch("../" + rel, { cache: "no-store" })
        if (raw.ok) {
          var text = await raw.text()
          if (text && text.trim().length > 0) return { content: text, origin: "disco" }
        }
      } catch (error) {
        /* fall through */
      }
    }
    var card = cardById(agent.source && agent.source.fabricatedFor)
    return {
      content: Core.renderFichaMarkdown(agent, card),
      origin: "proyectada",
    }
  }

  function inlineCode(text) {
    return esc(text).replace(/`([^`]+)`/g, function (_, code) {
      return "<code>" + code + "</code>"
    })
  }

  function renderMarkdown(container, markdown) {
    container.innerHTML = ""
    var lines = String(markdown || "").split("\n")
    var i = 0
    if (lines[0] === "---") {
      var front = []
      i = 1
      while (i < lines.length && lines[i] !== "---") {
        front.push(lines[i])
        i += 1
      }
      i += 1
      var pre = doc.createElement("pre")
      pre.className = "md-front"
      pre.textContent = front.join("\n")
      container.appendChild(pre)
    }
    var list = null
    for (; i < lines.length; i += 1) {
      var line = lines[i]
      if (/^\s*$/.test(line)) {
        list = null
        continue
      }
      if (/^#\s/.test(line)) {
        var h3 = doc.createElement("h3")
        h3.textContent = line.replace(/^#\s+/, "")
        container.appendChild(h3)
        list = null
        continue
      }
      if (/^##\s/.test(line)) {
        var h4 = doc.createElement("h4")
        h4.textContent = line.replace(/^##\s+/, "")
        container.appendChild(h4)
        list = null
        continue
      }
      if (/^\s*[-*]\s/.test(line)) {
        if (!list) {
          list = doc.createElement("ul")
          container.appendChild(list)
        }
        var li = doc.createElement("li")
        li.innerHTML = inlineCode(line.replace(/^\s*[-*]\s+/, ""))
        list.appendChild(li)
        continue
      }
      var p = doc.createElement("p")
      p.innerHTML = inlineCode(line)
      container.appendChild(p)
      list = null
    }
  }

  async function openAgent(agent) {
    var card = cardById(agent.source && agent.source.fabricatedFor)
    els.dialogAvatar.textContent = initials(agent.displayName)
    els.dialogTitle.textContent = agent.displayName
    els.dialogSub.textContent = agent.id + " · " + agent.role
    els.dialogMeta.innerHTML =
      agent.capabilities
        .slice(0, 8)
        .map(function (cap) {
          return '<span class="cap">' + esc(cap) + "</span>"
        })
        .join("") +
      (card
        ? '<span class="cap" data-kind="missing">card ' + esc(card.id) + "</span>"
        : "") +
      (agent.source && agent.source.kind === "factory"
        ? '<span class="badge" data-state="in_progress">fabricado</span>'
        : "")
    els.dialogBody.innerHTML = '<p class="md-front">cargando ficha…</p>'
    els.dialogOrigin.textContent = ""
    if (typeof els.dialog.showModal === "function") els.dialog.showModal()
    else els.dialog.setAttribute("open", "open")

    var resolved = await resolveFicha(agent)
    app.fichaOrigin = resolved.origin
    renderMarkdown(els.dialogBody, resolved.content)
    els.dialogOrigin.textContent =
      resolved.origin === "proyectada"
        ? "ficha proyectada (no escrita en disco)"
        : "ficha desde " + resolved.origin + " · " + toRepoRelative(agent.fichaPath)
    els.btnCopy.setAttribute(
      "data-copy",
      resolved.content,
    )
    announce("Ficha de " + agent.displayName + " abierta.")
  }

  // ---------------------------------------------------------------- controls
  function togglePause() {
    app.paused = !app.paused
    els.btnPause.setAttribute("aria-pressed", String(app.paused))
    els.btnPause.querySelector(".btn-label").textContent = app.paused
      ? "Reanudar"
      : "Pausar"
    els.pollChip.textContent = app.paused ? "poll pausado" : "poll " + app.interval + "ms"
    announce(app.paused ? "Polling pausado." : "Polling reanudado.")
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme)
    try {
      localStorage.setItem(STORAGE_THEME, theme)
    } catch (error) {
      /* private mode */
    }
    var dark = theme === "dark"
    els.btnTheme.setAttribute("aria-pressed", String(dark))
    els.btnTheme.setAttribute(
      "aria-label",
      dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro",
    )
    els.btnTheme.querySelector(".btn-label").textContent = dark ? "Claro" : "Oscuro"
  }

  function initTheme() {
    var stored = null
    try {
      stored = localStorage.getItem(STORAGE_THEME)
    } catch (error) {
      stored = null
    }
    var prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches
    applyTheme(stored || (prefersLight ? "light" : "dark"))
  }

  function copyFicha() {
    var content = els.btnCopy.getAttribute("data-copy") || ""
    var done = function () {
      els.btnCopy.querySelector(".btn-label").textContent = "Copiada"
      setTimeout(function () {
        els.btnCopy.querySelector(".btn-label").textContent = "Copiar ficha"
      }, 1800)
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(content).then(done, function () {
        announce("No se pudo copiar la ficha.")
      })
      return
    }
    announce("El navegador no permite copiar; seleccioná el texto a mano.")
  }

  // ---------------------------------------------------------------- polling
  function startPolling() {
    setInterval(function () {
      if (app.paused || app.running) return
      app.tick += 1
      var rosterTurn = app.tick % 3 === 0
      sync({ roster: rosterTurn }).catch(function () {})
    }, 800)
  }

  function wire() {
    els.btnFabricate.addEventListener("click", function () {
      var gap = focusGap()
      fabricate(gap ? gap.cardId : null)
    })
    els.btnPause.addEventListener("click", togglePause)
    els.btnResync.addEventListener("click", function () {
      sync({ manual: true })
    })
    els.btnTheme.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark"
      applyTheme(next)
      announce("Tema " + next + " aplicado.")
    })
    els.btnCopy.addEventListener("click", copyFicha)
    $("#btn-dialog-close").addEventListener("click", function () {
      els.dialog.close()
    })
    els.dialog.addEventListener("click", function (event) {
      if (event.target === els.dialog) els.dialog.close()
    })

    doc.addEventListener("keydown", function (event) {
      var tag = (event.target && event.target.tagName) || ""
      var typing = /INPUT|TEXTAREA|SELECT/.test(tag)
      if (typing) return
      if (event.key === "Escape") {
        if (els.dialog.open) return
        var keys = $(".keys[open]")
        if (keys) keys.removeAttribute("open")
        return
      }
      if (els.dialog.open) return
      if (event.key === " " && !/BUTTON|SUMMARY|A/.test(tag)) {
        event.preventDefault()
        togglePause()
        return
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault()
        sync({ manual: true })
        return
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault()
        if (!els.btnFabricate.disabled) els.btnFabricate.click()
        return
      }
      if (event.key === "?") {
        event.preventDefault()
        var details = $(".keys")
        var open = details.hasAttribute("open")
        if (open) details.removeAttribute("open")
        else details.setAttribute("open", "open")
      }
    })
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    initTheme()
    wire()
    resetSequence()
    startPolling()

    await sync({ manual: false })
    if (!app.snapshot) {
      els.btnFabricate.disabled = true
      return
    }

    var params = new URLSearchParams(window.location.search)
    var requested = params.get("card")
    if (requested) {
      app.focusId = requested
      recompute()
      renderAll()
    }

    var autoRun = params.get("auto") === "1" || params.get("fabricate") === "1"
    if (autoRun && app.preview) {
      setTimeout(function () {
        fabricate(app.focusId)
      }, 700)
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot)
  } else {
    boot()
  }
})()
