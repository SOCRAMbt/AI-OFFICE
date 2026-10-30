/*
 * leadership-model.js — modelo de decisiones para el panel del jefe.
 *
 * Se carga de dos formas:
 *   1. <script src="./lib/leadership-model.js">  (browser, file:// incluido)
 *   2. import "../lib/leadership-model.js"       (node --test, side-effect)
 *
 * No toca el DOM y no hace I/O: recibe un snapshot y devuelve decisiones
 * normalizadas. Todo lo que se dibuja en leadership.html sale de aca, asi que
 * cada regla se puede testear sin navegador.
 */
(function (root) {
  "use strict";

  // ───────────────────────────────────────────────────────────────────────────
  // Coordinadores (las tres secciones del panel)
  // ───────────────────────────────────────────────────────────────────────────

  /** @type {ReadonlyArray<{id:string,label:string,short:string,scope:string,tone:string}>} */
  var COORDINATORS = [
    {
      id: "commander",
      label: "Commander",
      short: "CMD",
      scope: "scope · prioridades · escalations",
      tone: "commander",
    },
    {
      id: "integrator",
      label: "Integrator",
      short: "INT",
      scope: "routing · leases · gates · deadlocks",
      tone: "integrator",
    },
    {
      id: "architect",
      label: "Architect",
      short: "ARC",
      scope: "tech decisions · patterns · contracts",
      tone: "architect",
    },
  ];

  var COORDINATOR_IDS = COORDINATORS.map(function (c) { return c.id; });

  // ───────────────────────────────────────────────────────────────────────────
  // Tipos de decision (el vocabulario de cada seccion)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * El orden importa: gana el primer patron que matchea.
   * Mas especifico primero (deadlock antes que gate, gate antes que routing).
   */
  var TYPE_RULES = [
    {
      type: "escalation",
      coordinator: "commander",
      re: /\bescalat|\bescalad|\bblocker\b|\bbloque[oa]|\bhalt\b|\bfreno\b|\bhuman[oa]?\b/i,
    },
    {
      type: "deadlock",
      coordinator: "integrator",
      re: /\bdeadlock\b|interbloqueo|\btrabad|\bstall(ed)?\b|\bcicl(o|a) de espera\b/i,
    },
    {
      type: "lease",
      coordinator: "integrator",
      re: /\blease\b|\bleasing\b|arrend|heartbeat|\bclaim\b|reclamo|\bttl\b/i,
    },
    {
      type: "gate",
      coordinator: "integrator",
      re: /\bgate\b|\bgates\b|quality gate|calidad|\brework\b|\bretry\b|\brechaz|rechaz|\breview\b|revisi[oó]n|\bfail(ed)?\b|\bnot_run\b/i,
    },
    {
      type: "routing",
      coordinator: "integrator",
      re: /\brouting\b|ruteo|asignaci[oó]n|asignad|\bowner\b|\breviewer\b|\bmatch\b|cobertura|capacit/,
    },
    {
      type: "spawn",
      coordinator: "integrator",
      re: /\bspawn\b|\bfactory\b|f[aá]brica|materializ|agente nuevo/i,
    },
    {
      type: "priority",
      coordinator: "commander",
      re: /prioridad|\bpriority\b|\borden\b|\bP[0-3]\b|\burgente\b|\bcritical\b/i,
    },
    {
      type: "scope",
      coordinator: "commander",
      re: /\bscope\b|alcance|objetiv|\bplan(ning)?\b|replan|descomposici|desglose/i,
    },
    {
      type: "contract",
      coordinator: "architect",
      re: /\bcontract\b|contrato|\binterface\b|\bschema\b|\bAPI\b|\bDTO\b|\btypes?\b|shape/i,
    },
    {
      type: "pattern",
      coordinator: "architect",
      re: /\bpattern\b|patr[oó]n|arquitect|architect|\bdesign\b|dise[nñ]o|\bADR\b|\bstack\b/i,
    },
    {
      type: "tech_decision",
      coordinator: "architect",
      re: /\bt[eé]cnic|\btech\b|implementaci|decisi[oó]n|\bdecid|\bcriterio\b/i,
    },
  ];

  var TYPE_LABELS = {
    escalation: "Escalation",
    deadlock: "Deadlock",
    lease: "Lease",
    gate: "Gate / rework",
    routing: "Routing",
    spawn: "Spawn / factory",
    priority: "Prioridad",
    scope: "Scope",
    contract: "Contract",
    pattern: "Pattern",
    tech_decision: "Tech decision",
    unknown: "General",
  };

  var TYPE_TO_COORDINATOR = (function () {
    var map = { unknown: "integrator" };
    TYPE_RULES.forEach(function (rule) { map[rule.type] = rule.coordinator; });
    return map;
  })();

  // ───────────────────────────────────────────────────────────────────────────
  // Actores
  // ───────────────────────────────────────────────────────────────────────────

  var ACTOR_RULES = [
    { re: /^(oficina-)?(director|commander|jefe|comandante)\b/i, coordinator: "commander" },
    { re: /^(oficina-)?(integrator|integrador|dispatcher|flow)\b/i, coordinator: "integrator" },
    { re: /^(oficina-)?(architect|arquitecto|arch|critic|critico)\b/i, coordinator: "architect" },
  ];

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  function isObj(v) {
    return v !== null && typeof v === "object";
  }

  function str(v) {
    return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
  }

  function clip(text, max) {
    var s = str(text).replace(/\s+/g, " ").trim();
    if (!max || s.length <= max) return s;
    return s.slice(0, max - 1).replace(/[\s,;:.]+$/, "") + "…";
  }

  function firstNonEmpty() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  var CARD_ID_RE = /\b([A-Z][A-Z0-9]{0,7}-\d{1,4})\b/;

  /** Busca un id de card tipo T-06 en cualquier texto del mensaje. */
  function inferCardId(msg) {
    if (!isObj(msg)) return null;
    var body = isObj(msg.body) ? msg.body : {};
    var direct = firstNonEmpty(body.card, body.cardId, body.card_id, msg.cardId);
    if (direct) return direct.toUpperCase();
    var hay = [msg.subject, body.text, body.summary, body.reason, body.title]
      .map(str)
      .join(" ");
    var m = CARD_ID_RE.exec(hay);
    return m ? m[1] : null;
  }

  /**
   * Deduce el coordinador que emitio una decision.
   * Prioridad: campo explicito > actor > tipo inferido.
   */
  function classifyActor(actor) {
    var a = str(actor).trim();
    if (!a) return null;
    for (var i = 0; i < ACTOR_RULES.length; i++) {
      if (ACTOR_RULES[i].re.test(a)) return ACTOR_RULES[i].coordinator;
    }
    return null;
  }

  function inferType(text) {
    var hay = str(text);
    if (!hay.trim()) return null;
    for (var i = 0; i < TYPE_RULES.length; i++) {
      if (TYPE_RULES[i].re.test(hay)) return TYPE_RULES[i].type;
    }
    return null;
  }

  /**
   * El campo `decision` de state.json es la transicion que ejecuto la maquina
   * de estados: es autoritativo sobre el texto libre del `reason`.
   * `approved` no dice nada del tema, asi que ahi manda el texto.
   */
  var FIELD_CLASSIFICATION = {
    escalated: { coordinator: "commander", type: "escalation" },
    replan: { coordinator: "architect", type: "pattern" },
    spawn_approved: { coordinator: "integrator", type: "spawn" },
    spawn_rejected: { coordinator: "integrator", type: "spawn" },
    rework: { coordinator: "integrator", type: "gate" },
  };

  /**
   * Clasifica una decision en {coordinator, type}.
   *
   * Prioridad: campo explicito > transicion de state.json > texto > actor.
   *
   * @param {{decision?:string, reason?:string, actor?:string, type?:string, coordinator?:string}} input
   */
  function classifyDecision(input) {
    var i = isObj(input) ? input : {};
    var explicitType = str(i.type).trim();
    var explicitCoord = str(i.coordinator).trim();
    var decisionField = str(i.decision).trim().toLowerCase();

    // Texto (reason + decision + subject) define el tema fino.
    var hay = [i.reason, i.subject, i.text].map(str).join(" ");
    var byText = inferType(hay);
    var byField = FIELD_CLASSIFICATION[decisionField] || null;

    var type;
    var coordinator;

    if (byField) {
      type = byField.type;
      coordinator = byField.coordinator;
      // Refinamiento dentro de la misma seccion: un rework cuyo texto dice
      // "deadlock" se muestra como deadlock, pero no cambia de seccion.
      if (byText && TYPE_TO_COORDINATOR[byText] === coordinator) type = byText;
    } else {
      type = byText || "unknown";
      coordinator =
        TYPE_TO_COORDINATOR[type] ||
        classifyActor(i.actor) ||
        "integrator";
      // approved sin tema reconocible: la firma del actor decide la seccion.
      if (type === "unknown") coordinator = classifyActor(i.actor) || "integrator";
    }

    if (explicitType) type = explicitType;
    if (explicitCoord) coordinator = explicitCoord;
    if (COORDINATOR_IDS.indexOf(coordinator) === -1) coordinator = "integrator";
    if (!TYPE_LABELS[type]) type = "unknown";

    return { coordinator: coordinator, type: type, typeLabel: TYPE_LABELS[type] || TYPE_LABELS.unknown };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Siguiente accion
  // ───────────────────────────────────────────────────────────────────────────

  var CARD_STATE_ES = {
    todo: "todo",
    in_progress: "in progress",
    review: "review",
    done: "done",
    rework: "rework",
    blocked: "blocked",
    escalated: "escalated",
  };

  /**
   * Deriva la proxima accion concreta. No inventa estado: se apoya en la card.
   *
   * @param {{type:string, coordinator:string, raw:string, actor:string}} item
   * @param {object|null} card
   */
  function deriveNextAction(item, card) {
    var c = isObj(card) ? card : null;
    var owner = c && c.owner ? c.owner : null;
    var ownerTxt = owner ? "`" + owner + "`" : "el owner";
    var state = c ? str(c.state) : "";
    var raw = str(item && item.raw).toLowerCase();
    var type = item && item.type ? item.type : "unknown";

    if (c && state === "done" && /approved/.test(raw)) return "Nada: la card ya cerro. Registrar como precedente.";

    switch (type) {
      case "escalation":
        return "Esperando decision del usuario: elegir una opcion de la escalada y desbloquear la card.";
      case "deadlock":
        return "Romper el ciclo: liberar el lease vencido y reasignar owner antes de reintentar.";
      case "lease":
        return "Renovar el lease antes del TTL; si el agente no da heartbeat, liberarlo.";
      case "gate":
        if (state === "rework") return ownerTxt + " rehace contra review.md y vuelve a correr los gates.";
        if (state === "review") return "Revisor aprueba y despues se corren los gates de la card.";
        return "Correr los gates de la card y registrar la evidencia.";
      case "routing":
        if (state === "todo" || state === "in_progress") {
          return owner ? "Esperar claim y heartbeat de " + ownerTxt + "." : "Asignar owner: no hay agente disponible en el catalogo.";
        }
        if (state === "done") return "Ruta cerrada: no requiere accion.";
        return "Revisar que owner/reviewer sigan vivos antes de avanzar.";
      case "spawn":
        if (/reject/.test(raw)) return "Buscar cobertura alternativa o reenviar SPAWN_REQUEST con mejor justificacion.";
        return "La factory materializa el agente y lo suma al catalogo para el proximo match.";
      case "priority":
        return "Reordenar la cola de cards segun la nueva prioridad.";
      case "scope":
        return "Actualizar el plan (plan.json) y re-scopear la card afectada.";
      case "contract":
        return "Fijar el contrato en el handoff y consumirlo desde el lado que lo implementa.";
      case "pattern":
        return "Aplicar el patron en la implementacion y anotarlo en context.decisions.";
      case "tech_decision":
        return "Implementar segun el criterio y registrarlo para las cards que vengan.";
      default:
        return "Revisar la card y sus artifacts para decidir el proximo paso.";
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Links
  // ───────────────────────────────────────────────────────────────────────────

  var ARTIFACTS_ROOT = "../.oficina/artifacts";

  /** Devuelve todos los enlaces de una card. */
  function cardLinks(cardId) {
    if (!cardId) {
      return { card: null, kanban: null, artifacts: null, handoff: null, evidence: null, gates: null };
    }
    var dir = ARTIFACTS_ROOT + "/" + encodeURIComponent(cardId) + "/";
    return {
      card: "#card-" + cardId,
      kanban: "kanban.html#" + encodeURIComponent(cardId),
      artifacts: dir,
      handoff: dir + "handoff.md",
      evidence: dir + "evidence.md",
      gates: dir + "gates.md",
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Normalizacion
  // ───────────────────────────────────────────────────────────────────────────

  var DECISION_ES = {
    approved: "Aprobado",
    rework: "Rework",
    replan: "Replan",
    escalated: "Escalado",
    spawn_approved: "Spawn aprobado",
    spawn_rejected: "Spawn rechazado",
  };

  function actorLabel(actorId, roster) {
    var id = str(actorId);
    if (roster && isObj(roster.agents) && roster.agents[id] && roster.agents[id].displayName) {
      return roster.agents[id].displayName;
    }
    if (!id) return "oficina";
    return id;
  }

  /**
   * Convierte un DecisionRecord de state.json en una decision de UI.
   *
   * @param {object} rec
   * @param {{cards:object, roster:object, escalations:object[], artifacts:object, now:number}} ctx
   */
  function normalizeDecisionRecord(rec, ctx) {
    var c = ctx || {};
    var cards = isObj(c.cards) ? c.cards : {};
    var cardId = firstNonEmpty(rec && rec.cardId) || null;
    var card = cardId && cards[cardId] ? cards[cardId] : null;
    var rawDecision = str(rec && rec.decision) || "approved";
    var reason = str(rec && rec.reason);
    var cls = classifyDecision({
      decision: rawDecision,
      reason: reason,
      actor: rec && rec.actor,
      type: rec && rec.type,
      coordinator: rec && rec.coordinator,
    });

    var item = {
      id: "state:" + (rec && rec.id ? rec.id : cardId + ":" + (rec && rec.at) + ":" + rawDecision),
      source: "state",
      channel: null,
      at: str(rec && rec.at) || new Date(c.now || Date.now()).toISOString(),
      actorId: str(rec && rec.actor) || "oficina",
      cardId: cardId,
      cardTitle: card ? str(card.title) : "",
      cardState: card ? str(card.state) : "",
      raw: rawDecision,
      decision: (DECISION_ES[rawDecision] || rawDecision) + (cls.type !== "unknown" ? " · " + cls.typeLabel : ""),
      reason: reason || "(sin razon registrada)",
      coordinator: cls.coordinator,
      type: cls.type,
      typeLabel: cls.typeLabel,
      priority: rawDecision === "escalated" ? "critical" : "normal",
      decisionLike: true,
      links: cardLinks(cardId),
    };
    item.nextAction = deriveNextAction(item, card);
    item.actorLabel = actorLabel(item.actorId, c.roster);
    item.actorRole = classifyActor(item.actorId) || "worker";
    return item;
  }

  /** Escalations abiertas de state.json -> decisiones de Commander. */
  function normalizeEscalation(esc, ctx) {
    var c = ctx || {};
    var cards = isObj(c.cards) ? c.cards : {};
    var cardId = firstNonEmpty(esc && esc.cardId) || null;
    var card = cardId && cards[cardId] ? cards[cardId] : null;
    var options = Array.isArray(esc && esc.options) ? esc.options : [];
    var label = options.length ? options[0].label : "sin opciones registradas";
    var reason = firstNonEmpty(esc && esc.cause, "escalation sin causa") +
      (esc && esc.recommendation ? " — recomendacion: " + esc.recommendation : "");

    var item = {
      id: "esc:" + (esc && esc.id ? esc.id : cardId),
      source: "escalation",
      channel: null,
      at: str(esc && esc.at) || new Date(c.now || Date.now()).toISOString(),
      actorId: "commander",
      actorLabel: "Commander",
      actorRole: "commander",
      cardId: cardId,
      cardTitle: card ? str(card.title) : "",
      cardState: card ? str(card.state) : "",
      raw: "escalated",
      decision: "Escalado · " + clip(label, 60),
      reason: reason,
      coordinator: "commander",
      type: "escalation",
      typeLabel: TYPE_LABELS.escalation,
      priority: "critical",
      decisionLike: true,
      links: cardLinks(cardId),
      options: options.map(function (o) { return { label: str(o && o.label), tradeoff: str(o && o.tradeoff) }; }),
      status: str(esc && esc.status) || "open",
    };
    item.nextAction = "El usuario elige una de las " + (options.length || 0) + " opciones y la card sale de blocked.";
    return item;
  }

  var QUESTION_KINDS = { QUESTION: 1, HELP_QUESTION: 1, HELP_REQUEST: 1 };

  var CHANNEL_COORDINATOR = {
    "coord-command": "commander",
    "coord-flow": "integrator",
    "coord-arch": "architect",
  };

  /**
   * Convierte un mensaje del bus en una decision de UI.
   *
   * @param {object} msg
   * @param {{channel?:string, cards:object, roster:object, now:number}} ctx
   */
  function normalizeBusMessage(msg, ctx) {
    var c = ctx || {};
    var cards = isObj(c.cards) ? c.cards : {};
    var channel = str(c.channel);
    var body = isObj(msg && msg.body) ? msg.body : {};
    var cardId = inferCardId(msg);
    var card = cardId && cards[cardId] ? cards[cardId] : null;
    var kind = str(msg && msg.kind) || "NOTICE";
    var subject = firstNonEmpty(msg && msg.subject, body.title, "(sin asunto)");
    var reason = firstNonEmpty(
      body.reason,
      body.rationale,
      body.summary,
      body.text,
      body.note,
      body.recommendation,
      clip(JSON.stringify(body), 400)
    );
    var cls = classifyDecision({
      decision: body.decision,
      reason: firstNonEmpty(body.reason, body.summary, body.text, subject),
      subject: subject,
      actor: msg && msg.from,
      type: body.type,
      coordinator: body.coordinator || CHANNEL_COORDINATOR[channel] || null,
    });

    var item = {
      id: "msg:" + (msg && msg.id ? msg.id : channel + ":" + (msg && msg.seq)),
      source: "bus",
      channel: channel || null,
      at: str(msg && msg.createdAt) || new Date(c.now || Date.now()).toISOString(),
      actorId: str(msg && msg.from) || "oficina",
      cardId: cardId,
      cardTitle: card ? str(card.title) : "",
      cardState: card ? str(card.state) : "",
      raw: kind.toLowerCase(),
      decision: kind + " · " + clip(subject, 90),
      reason: reason || "(mensaje sin cuerpo)",
      coordinator: cls.coordinator,
      type: cls.type,
      typeLabel: cls.typeLabel,
      priority: str(msg && msg.priority) || "normal",
      decisionLike: !QUESTION_KINDS[kind],
      links: cardLinks(cardId),
      messageId: msg && msg.id ? msg.id : null,
      seq: isObj(msg) && typeof msg.seq === "number" ? msg.seq : null,
      to: Array.isArray(msg && msg.to) ? msg.to.slice() : [],
    };
    item.nextAction = deriveNextAction(item, card);
    item.actorLabel = actorLabel(item.actorId, c.roster);
    item.actorRole = classifyActor(item.actorId) || "worker";
    return item;
  }

  /** Entradas del ledger de contexto (state.context.decisions) -> Architect. */
  function normalizeContextDecision(text, index, ctx) {
    var c = ctx || {};
    var cardId = null;
    var m = CARD_ID_RE.exec(str(text));
    if (m) cardId = m[1];
    var cards = isObj(c.cards) ? c.cards : {};
    var card = cardId && cards[cardId] ? cards[cardId] : null;
    var cls = classifyDecision({ decision: "approved", reason: text, actor: "architect", type: "tech_decision" });
    var item = {
      id: "ctx:" + index,
      source: "context",
      channel: null,
      at: str(c.nowIso) || new Date(c.now || Date.now()).toISOString(),
      actorId: "architect",
      actorLabel: "Architect",
      actorRole: "architect",
      cardId: cardId,
      cardTitle: card ? str(card.title) : "",
      cardState: card ? str(card.state) : "",
      raw: "context.decisions",
      decision: "Tech decision registrada",
      reason: str(text),
      coordinator: "architect",
      type: cls.type,
      typeLabel: cls.typeLabel,
      priority: "normal",
      decisionLike: true,
      links: cardLinks(cardId),
      checkpoint: true,
    };
    item.nextAction = deriveNextAction(item, card);
    return item;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Señales: no son decisiones registradas, son condiciones que hoy piden
  // intervencion del jefe. Se marcan como `signal` para no confundirlas con
  // decisiones tomadas.
  // ───────────────────────────────────────────────────────────────────────────

  function signalBase(fields) {
    var item = {
      source: "signal",
      channel: null,
      priority: "high",
      decisionLike: false,
      links: cardLinks(fields.cardId || null),
      cardId: fields.cardId || null,
      cardTitle: fields.cardTitle || "",
      cardState: fields.cardState || "",
      actorId: fields.actorId,
      actorLabel: fields.actorLabel,
      actorRole: fields.actorRole,
      coordinator: fields.coordinator,
      type: fields.type,
      typeLabel: TYPE_LABELS[fields.type] || TYPE_LABELS.unknown,
      at: fields.at,
      raw: fields.raw,
      decision: fields.decision,
      reason: fields.reason,
    };
    item.nextAction = deriveNextAction(item, fields.card || null);
    return item;
  }

  /** state.halt != null -> Commander. */
  function normalizeHalt(halt, ctx) {
    if (!isObj(halt) || !halt.reason) return null;
    return signalBase({
      id: "halt:" + (halt.at || "now"),
      at: str(halt.at) || str(ctx.nowIso),
      actorId: str(halt.by) || "commander",
      actorLabel: (str(halt.by) || "commander") + " · halt",
      actorRole: "commander",
      coordinator: "commander",
      type: "escalation",
      raw: "halt",
      decision: "Freno de emergencia activo",
      reason: str(halt.reason),
    });
  }

  /** Leases vencidos o sin heartbeat -> Integrator. */
  function normalizeLease(lease, ctx) {
    if (!isObj(lease)) return null;
    var expires = Date.parse(str(lease.expiresAt));
    if (!isFinite(expires)) return null;
    var now = typeof ctx.now === "number" ? ctx.now : Date.now();
    if (expires > now) return null; // vigente: no pide intervencion
    var hb = Date.parse(str(lease.heartbeatAt));
    var hbAge = isFinite(hb) ? Math.round((now - hb) / 1000) : null;
    var cardId = str(lease.taskId) || null;
    var cards = isObj(ctx.cards) ? ctx.cards : {};
    var card = cardId && cards[cardId] ? cards[cardId] : null;
    var overdue = Math.round((now - expires) / 1000);

    return signalBase({
      id: "lease:" + (cardId || "?") + ":" + str(lease.expiresAt),
      at: str(lease.expiresAt),
      actorId: str(lease.agentId) || "integrator",
      actorLabel: str(lease.agentId) || "lease",
      actorRole: "integrator",
      coordinator: "integrator",
      type: "lease",
      raw: "lease_expired",
      decision: "Lease vencido" + (cardId ? " · " + cardId : ""),
      reason:
        "expiró hace " + overdue + "s" +
        (hbAge !== null ? " · último heartbeat hace " + hbAge + "s" : "") +
        " · renovaciones: " + (lease.renewals || 0),
      cardId: cardId,
      card: card,
      cardTitle: card ? str(card.title) : "",
      cardState: card ? str(card.state) : "",
    });
  }

  /** pendingGates -> Integrator/gate. */
  function normalizePendingGate(cardId, ctx) {
    var cards = isObj(ctx.cards) ? ctx.cards : {};
    var card = cards[cardId] || null;
    return signalBase({
      id: "gate:" + cardId,
      at: str(ctx.nowIso),
      actorId: "integrator",
      actorLabel: "integrator · gate pendiente",
      actorRole: "integrator",
      coordinator: "integrator",
      type: "gate",
      raw: "pending_gate",
      decision: "Gate pendiente · " + cardId,
      reason: "la card espera la corrida de gates para poder cerrarse",
      cardId: cardId,
      card: card,
      cardTitle: card ? str(card.title) : "",
      cardState: card ? str(card.state) : "",
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Extraccion
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Extrae y agrupa decisiones desde un snapshot de la oficina.
   *
   * @param {object} snapshot  {state, roster, messages:[{channel,message}], artifacts}
   * @param {object} [opts]    {now, includePeer}
   * @returns {{items:object[], sections:object, counts:object, runId:string}}
   */
  function extractDecisions(snapshot, opts) {
    var o = isObj(opts) ? opts : {};
    var s = isObj(snapshot) ? snapshot : {};
    var state = isObj(s.state) ? s.state : {};
    var roster = isObj(s.roster) ? s.roster : {};
    var cards = isObj(state.cards) ? state.cards : {};
    var now = typeof o.now === "number" ? o.now : Date.now();
    var nowIso = new Date(now).toISOString();
    var ctx = { cards: cards, roster: roster, artifacts: s.artifacts, now: now, nowIso: nowIso };

    var items = [];

    (Array.isArray(state.decisions) ? state.decisions : []).forEach(function (rec) {
      if (!isObj(rec)) return;
      items.push(normalizeDecisionRecord(rec, ctx));
    });

    (Array.isArray(state.escalations) ? state.escalations : []).forEach(function (esc) {
      if (!isObj(esc)) return;
      if (str(esc.status) === "resolved") return;
      items.push(normalizeEscalation(esc, ctx));
    });

    var ledger = isObj(state.context) && Array.isArray(state.context.decisions) ? state.context.decisions : [];
    ledger.forEach(function (text, i) { items.push(normalizeContextDecision(text, i, ctx)); });

    var messages = Array.isArray(s.messages) ? s.messages : [];
    messages.forEach(function (entry) {
      if (!isObj(entry) || !isObj(entry.message)) return;
      var channel = str(entry.channel);
      if (!o.includePeer && channel === "peer") return;
      if (channel && !CHANNEL_COORDINATOR[channel] && channel !== "peer") return;
      items.push(normalizeBusMessage(entry.message, {
        channel: channel, cards: cards, roster: roster, now: now,
      }));
    });

    // Dedup: mismo origen + mismo payload no se muestra dos veces.
    var seen = {};
    items = items.filter(function (it) {
      var key = it.source + "|" + it.id;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    items.sort(function (a, b) {
      var ta = Date.parse(a.at) || 0;
      var tb = Date.parse(b.at) || 0;
      if (tb !== ta) return tb - ta;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    var sections = { commander: [], integrator: [], architect: [] };
    items.forEach(function (it) {
      (sections[it.coordinator] = sections[it.coordinator] || []).push(it);
    });

    return {
      items: items,
      sections: sections,
      counts: {
        total: items.length,
        commander: sections.commander.length,
        integrator: sections.integrator.length,
        architect: sections.architect.length,
      },
      runId: str(state.runId),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Filtros
  // ───────────────────────────────────────────────────────────────────────────

  var EMPTY_FILTERS = { coordinator: "all", card: "all", type: "all", query: "", onlyDecisions: false };

  /**
   * @param {object[]} items
   * @param {{coordinator?:string, card?:string, type?:string, query?:string, onlyDecisions?:boolean}} filters
   */
  function filterDecisions(items, filters) {
    var f = Object.assign({}, EMPTY_FILTERS, isObj(filters) ? filters : {});
    var q = str(f.query).trim().toLowerCase();
    return (Array.isArray(items) ? items : []).filter(function (it) {
      if (f.coordinator !== "all" && it.coordinator !== f.coordinator) return false;
      if (f.card !== "all" && it.cardId !== f.card) return false;
      if (f.type !== "all" && it.type !== f.type) return false;
      if (f.onlyDecisions && !it.decisionLike) return false;
      if (q) {
        var hay = [it.decision, it.reason, it.nextAction, it.actorId, it.actorLabel, it.cardId, it.cardTitle, it.typeLabel, it.channel]
          .map(str)
          .join(" ")
          .toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /** Agrupa por coordinador respetando el filtro; siempre devuelve las 3 claves. */
  function groupByCoordinator(items) {
    var out = { commander: [], integrator: [], architect: [] };
    (Array.isArray(items) ? items : []).forEach(function (it) {
      (out[it.coordinator] = out[it.coordinator] || []).push(it);
    });
    return out;
  }

  /** Opciones de filtro derivadas de los datos presentes. */
  function filterOptions(items) {
    var cards = {};
    var types = {};
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (it.cardId) cards[it.cardId] = it.cardTitle || it.cardState || "";
      types[it.type] = { id: it.type, label: it.typeLabel, coordinator: it.coordinator, count: (types[it.type] ? types[it.type].count : 0) + 1 };
    });
    return {
      cards: Object.keys(cards).sort().map(function (id) { return { id: id, title: cards[id] }; }),
      types: Object.keys(types)
        .map(function (k) { return types[k]; })
        .sort(function (a, b) {
          var ci = COORDINATOR_IDS.indexOf(a.coordinator) - COORDINATOR_IDS.indexOf(b.coordinator);
          return ci !== 0 ? ci : a.label.localeCompare(b.label);
        }),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Tiempo
  // ───────────────────────────────────────────────────────────────────────────

  /** "hace 12s", "hace 3m", "hace 2h", "hace 4d". */
  function formatRelative(iso, now) {
    var t = Date.parse(str(iso));
    if (!isFinite(t)) return "—";
    var diff = Math.max(0, (typeof now === "number" ? now : Date.now()) - t);
    var s = Math.round(diff / 1000);
    if (s < 5) return "ahora";
    if (s < 60) return "hace " + s + "s";
    var m = Math.round(s / 60);
    if (m < 60) return "hace " + m + "m";
    var h = Math.round(m / 60);
    if (h < 24) return "hace " + h + "h";
    var d = Math.round(h / 24);
    return "hace " + d + "d";
  }

  function formatClock(iso) {
    var t = Date.parse(str(iso));
    if (!isFinite(t)) return "—";
    var d = new Date(t);
    function p(n) { return n < 10 ? "0" + n : String(n); }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Demo (para file:// sin datos y para tests manuales)
  // ───────────────────────────────────────────────────────────────────────────

  function demoSnapshot(now) {
    var t = typeof now === "number" ? now : Date.now();
    function at(secAgo) { return new Date(t - secAgo * 1000).toISOString(); }
    return {
      generatedAt: new Date(t).toISOString(),
      source: "demo",
      state: {
        version: 2,
        runId: "run-demo",
        status: "running",
        cards: {
          "T-06": {
            id: "T-06",
            title: "Panel de intervencion del jefe",
            state: "in_progress",
            owner: "e-xr-immersive-developer",
            reviewer: "e-testing-api-tester",
            attempts: 1,
            rejections: 0,
          },
          "T-00": { id: "T-00", title: "Guard anti-gate-verde-vacio", state: "done", owner: "e-testing-api-tester", reviewer: null },
        },
        decisions: [
          { at: at(5400), cardId: "T-06", decision: "approved", reason: "routing: mejor match de capabilities (3)", actor: "integrator" },
          { at: at(3600), cardId: "T-00", decision: "rework", reason: "1 de 3 rechazos: gate secrecy FAIL", actor: "oficina-critico" },
          { at: at(1200), cardId: "T-00", decision: "escalated", reason: "la card no cierra sin decision humana sobre el scan de tests", actor: "e-testing-api-tester" },
        ],
        escalations: [
          {
            id: "esc-1",
            cardId: "T-00",
            at: at(1200),
            cause: "el gate de seguridad escanea los propios fixtures del repo",
            options: [
              { id: "o1", label: "Excluir tests/** del scan", tradeoff: "oculta secretos reales en tests" },
              { id: "o2", label: "Neutralizar fixtures por concatenacion", tradeoff: "requiere rework de tests" },
            ],
            recommendation: "o2",
            status: "open",
          },
        ],
        context: { decisions: ["HTML + CSS + JS vanilla sin build step (T-02)", "Lectura read-only de .oficina/** via snapshot"] },
      },
      roster: {
        agents: {
          "e-xr-immersive-developer": { id: "e-xr-immersive-developer", role: "xr-immersive-developer", displayName: "XR Immersive Developer" },
          "e-testing-api-tester": { id: "e-testing-api-tester", role: "testing-api-tester", displayName: "API Tester" },
        },
      },
      messages: [
        {
          channel: "coord-flow",
          message: {
            id: "m-demo-1", seq: 1, from: "integrator", to: ["e-xr-immersive-developer"], kind: "NOTICE",
            subject: "T-06 despachada: dashboard/** es tu territorio",
            body: { card: "T-06", decision: "route", reason: "owner asignado por cobertura de capability frontend", },
            createdAt: at(5400), priority: "normal",
          },
        },
        {
          channel: "coord-arch",
          message: {
            id: "m-demo-2", seq: 2, from: "architect", to: ["*"], kind: "NOTICE",
            subject: "Contrato de snapshot unico para todos los paneles",
            body: { type: "contract", reason: "un endpoint /api/snapshot evita lecturas rasgadas entre state.json y bus", text: "snapshot { state, roster, messages[], artifacts }", },
            createdAt: at(7200), priority: "high",
          },
        },
        {
          channel: "coord-command",
          message: {
            id: "m-demo-3", seq: 3, from: "oficina-director", to: ["integrator"], kind: "STATUS",
            subject: "Prioridad: T-06 antes que T-08",
            body: { text: "el panel del jefe es requisito de T-10; factory puede esperar", card: "T-06" },
            createdAt: at(2400), priority: "high",
          },
        },
      ],
      artifacts: { "T-06": { dir: "../.oficina/artifacts/T-06/", files: ["handoff.md", "evidence.md"] } },
    };
  }

  var API = {
    COORDINATORS: COORDINATORS,
    COORDINATOR_IDS: COORDINATOR_IDS,
    TYPE_LABELS: TYPE_LABELS,
    TYPE_TO_COORDINATOR: TYPE_TO_COORDINATOR,
    CHANNEL_COORDINATOR: CHANNEL_COORDINATOR,
    ARTIFACTS_ROOT: ARTIFACTS_ROOT,
    classifyActor: classifyActor,
    classifyDecision: classifyDecision,
    deriveNextAction: deriveNextAction,
    inferCardId: inferCardId,
    cardLinks: cardLinks,
    normalizeDecisionRecord: normalizeDecisionRecord,
    normalizeEscalation: normalizeEscalation,
    normalizeBusMessage: normalizeBusMessage,
    extractDecisions: extractDecisions,
    filterDecisions: filterDecisions,
    groupByCoordinator: groupByCoordinator,
    filterOptions: filterOptions,
    formatRelative: formatRelative,
    formatClock: formatClock,
    demoSnapshot: demoSnapshot,
    clip: clip,
  };

  root.OficinaLeadership = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
