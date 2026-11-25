/*
 * debate-core.js — lógica pura del panel de debate (T-05).
 *
 * Se carga como script clásico (no módulo) para que funcione tanto con
 * `file://` como servido por `dashboard/server.mjs`, y se publica como
 * `globalThis.DebateCore`. Sin DOM, sin red: todo lo que decide qué es un
 * debate, cómo se anidan las respuestas y en qué estado está un hilo vive acá,
 * y por eso es lo que cubren los tests (`dashboard/tests/*.test.mjs`).
 *
 * Contrato de entrada: `BusMessage` de `src/core/bus.ts`
 *   { id, seq, from, to[], kind, subject, body{}, inReplyTo, ttlSec,
 *     createdAt, priority, idempotencyKey, hops }
 */
(function (root) {
  "use strict";

  /** Respuestas que anidan bajo un HELP_REQUEST. */
  var RESPONSE_KINDS = ["HELP_ACCEPT", "HELP_DECLINE", "HELP_PARTIAL", "HELP_QUESTION"];
  /** Tipos que cierran un hilo (el que pidió ayuda reporta el desenlace). */
  var CLOSURE_KINDS = ["STATUS", "NOTICE", "ANSWER"];

  var RESPONSE_SET = toSet(RESPONSE_KINDS);
  var CLOSURE_SET = toSet(CLOSURE_KINDS);
  var KIND_SET = toSet([
    "HELP_REQUEST", "HELP_ACCEPT", "HELP_DECLINE", "HELP_PARTIAL", "HELP_QUESTION",
    "QUESTION", "ANSWER", "SPAWN_REQUEST", "SPAWN_APPROVED", "SPAWN_REJECTED",
    "CLAIM", "RELEASE", "STATUS", "NOTICE",
  ]);
  var PRIORITIES = toSet(["low", "normal", "high", "critical"]);
  var DEFAULT_TTL_SEC = 900;

  var STATUS_LABELS = {
    pending: "Esperando respuesta",
    accepted: "Aceptado",
    declined: "Rechazado",
    partial: "Parcial",
    completed: "Completado",
  };
  var KIND_LABELS = {
    HELP_REQUEST: "Pide ayuda",
    HELP_ACCEPT: "Acepta",
    HELP_DECLINE: "Rechaza",
    HELP_PARTIAL: "Ayuda parcial",
    HELP_QUESTION: "Pregunta",
    QUESTION: "Pregunta",
    ANSWER: "Respuesta",
    STATUS: "Estado",
    NOTICE: "Aviso",
  };
  var BODY_LABELS = {
    need: "Necesita",
    why_me: "Por qué no lo resuelve solo",
    whyMe: "Por qué no lo resuelve solo",
    answer: "Respuesta",
    summary: "Resumen",
    reason: "Motivo",
    text: "Mensaje",
    message: "Mensaje",
    detail: "Detalle",
    card: "Card",
    state: "Estado",
    available_for: "Disponible para",
    quality_gate: "Control de calidad",
  };
  var BODY_ORDER = Object.keys(BODY_LABELS);

  // ---------------------------------------------------------------- helpers

  function toSet(list) {
    var set = Object.create(null);
    for (var i = 0; i < list.length; i += 1) set[list[i]] = true;
    return set;
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function str(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function parseTime(iso) {
    if (typeof iso !== "string") return NaN;
    var t = Date.parse(iso);
    return Number.isFinite(t) ? t : NaN;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fold(value) {
    var text = String(value == null ? "" : value).toLowerCase();
    if (typeof text.normalize === "function") {
      text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    return text;
  }

  // ------------------------------------------------------- normalización

  /**
   * Valida y normaliza un mensaje del bus. Devuelve null si no sirve
   * (sin id o sin createdAt parseable) — un mensaje ilegible no debe
   * romper el panel ni inventar un hilo.
   */
  function normalizeMessage(raw, channel) {
    if (!isObject(raw)) return null;
    var id = str(raw.id);
    if (!id) return null;
    var createdAt = parseTime(raw.createdAt);
    if (!Number.isFinite(createdAt)) return null;

    var kind = str(raw.kind).toUpperCase();
    if (!KIND_SET[kind]) kind = "NOTICE";

    var to = [];
    if (Array.isArray(raw.to)) {
      for (var i = 0; i < raw.to.length; i += 1) {
        var addr = str(raw.to[i]);
        if (addr && to.indexOf(addr) === -1) to.push(addr);
      }
    } else if (typeof raw.to === "string" && str(raw.to)) {
      to.push(str(raw.to));
    }

    var ttl = Number(raw.ttlSec);
    if (!Number.isFinite(ttl) || ttl <= 0) ttl = DEFAULT_TTL_SEC;

    var priority = str(raw.priority).toLowerCase();
    if (!PRIORITIES[priority]) priority = "normal";

    var seq = Number(raw.seq);

    return {
      id: id,
      seq: Number.isFinite(seq) ? seq : 0,
      from: str(raw.from) || "desconocido",
      to: to,
      kind: kind,
      subject: str(raw.subject),
      body: isObject(raw.body) ? raw.body : {},
      inReplyTo: str(raw.inReplyTo) || null,
      ttlSec: ttl,
      createdAt: new Date(createdAt).toISOString(),
      createdAtMs: createdAt,
      expiresAtMs: createdAt + ttl * 1000,
      priority: priority,
      idempotencyKey: str(raw.idempotencyKey) || null,
      hops: Number.isFinite(Number(raw.hops)) ? Number(raw.hops) : 0,
      channel: str(channel || raw.channel) || null,
    };
  }

  /** ¿Es un pedido de ayuda dirigido a todos? (criterio 1) */
  function isBroadcastHelpRequest(message) {
    return !!message && message.kind === "HELP_REQUEST" && message.to.indexOf("*") !== -1;
  }

  /**
   * ¿Abre un hilo de debate? Broadcast (to:['*']) o pedido a varios peers.
   * El broadcast es el caso canónico; un pedido a 2+ agentes también genera
   * respuestas anidadas y no queremos perderlo.
   */
  function isDebateRoot(message) {
    return !!message && message.kind === "HELP_REQUEST" && (message.to.indexOf("*") !== -1 || message.to.length > 1);
  }

  function isExpired(message, now) {
    var t = Number.isFinite(now) ? now : Date.now();
    return t > message.expiresAtMs;
  }

  /** Deduplica por id conservando el primer registro y el canal original. */
  function dedupeMessages(messages) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < messages.length; i += 1) {
      var m = messages[i];
      if (!m || seen[m.id]) continue;
      seen[m.id] = true;
      out.push(m);
    }
    return out;
  }

  // ---------------------------------------------------------------- hilos

  function resolveRootOf(message, byId, rootIds) {
    var current = message;
    var guard = 0;
    while (current && current.inReplyTo && guard < 32) {
      guard += 1;
      if (rootIds[current.inReplyTo]) return rootIds[current.inReplyTo];
      current = byId[current.inReplyTo] || null;
    }
    return null;
  }

  /**
   * Agrupa mensajes en hilos de debate.
   *
   * - raíz: HELP_REQUEST broadcast (o multi-destinatario)
   * - respuestas: cualquier mensaje que apunte a la raíz, directo o a través
   *   de otro mensaje del hilo (inReplyTo transitivo)
   * - huérfanas: respuestas cuyo inReplyTo no existe en el snapshot pero cuyo
   *   `subject` identifica un único hilo → se reenganchan (el bus rota por TTL
   *   y el padre puede haber vencido). Si es ambiguo, van a `unlinked` y se
   *   reportan, no se adivinan.
   */
  function buildThreads(messages, options) {
    var opts = options || {};
    var now = Number.isFinite(opts.now) ? opts.now : Date.now();

    var normalized = [];
    for (var i = 0; i < messages.length; i += 1) {
      var m = normalizeMessage(messages[i], messages[i] && messages[i].channel);
      if (m) normalized.push(m);
    }
    var unique = dedupeMessages(normalized);

    var byId = Object.create(null);
    for (var j = 0; j < unique.length; j += 1) byId[unique[j].id] = unique[j];

    var roots = [];
    var rootIds = Object.create(null);
    for (var k = 0; k < unique.length; k += 1) {
      if (isDebateRoot(unique[k])) {
        roots.push(unique[k]);
        rootIds[unique[k].id] = unique[k].id;
      }
    }

    var repliesByRoot = Object.create(null);
    for (var r = 0; r < roots.length; r += 1) repliesByRoot[roots[r].id] = [];

    var rootsBySubject = Object.create(null);
    for (var s = 0; s < roots.length; s += 1) {
      var subject = fold(roots[s].subject);
      if (!subject) continue;
      if (!rootsBySubject[subject]) rootsBySubject[subject] = [];
      rootsBySubject[subject].push(roots[s]);
    }

    var unlinked = [];
    for (var n = 0; n < unique.length; n += 1) {
      var msg = unique[n];
      if (rootIds[msg.id]) continue;

      var target = msg.inReplyTo ? resolveRootOf(msg, byId, rootIds) : null;
      if (target) {
        repliesByRoot[target].push(msg);
        continue;
      }

      // Reenganche por subject: solo respuestas de ayuda, solo si hay un
      // único hilo candidato y no se está contestando a sí mismo.
      var candidates = RESPONSE_SET[msg.kind] && msg.subject ? rootsBySubject[fold(msg.subject)] : null;
      if (candidates && candidates.length === 1 && candidates[0].from !== msg.from) {
        repliesByRoot[candidates[0].id].push(msg);
        msg.reattached = true;
        continue;
      }

      if (msg.inReplyTo || RESPONSE_SET[msg.kind]) unlinked.push(msg);
    }

    var threads = [];
    for (var t = 0; t < roots.length; t += 1) {
      var rootMsg = roots[t];
      var replies = repliesByRoot[rootMsg.id].slice().sort(compareByTime);
      threads.push(buildThread(rootMsg, replies, now));
    }
    threads.sort(compareThreads);

    return { threads: threads, unlinked: unlinked, byId: byId, messages: unique };
  }

  function compareByTime(a, b) {
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    return a.seq - b.seq;
  }

  function compareThreads(a, b) {
    if (b.updatedAtMs !== a.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
    return a.root.seq - b.root.seq;
  }

  function buildThread(rootMessage, replies, now) {
    var counts = { accept: 0, decline: 0, partial: 0, question: 0, closure: 0, other: 0 };
    var participants = [rootMessage.from];
    var updatedAtMs = rootMessage.createdAtMs;

    for (var i = 0; i < replies.length; i += 1) {
      var m = replies[i];
      if (m.kind === "HELP_ACCEPT") counts.accept += 1;
      else if (m.kind === "HELP_DECLINE") counts.decline += 1;
      else if (m.kind === "HELP_PARTIAL") counts.partial += 1;
      else if (m.kind === "HELP_QUESTION" || m.kind === "QUESTION") counts.question += 1;
      else if (CLOSURE_SET[m.kind]) counts.closure += 1;
      else counts.other += 1;

      if (participants.indexOf(m.from) === -1) participants.push(m.from);
      if (m.createdAtMs > updatedAtMs) updatedAtMs = m.createdAtMs;
    }

    var thread = {
      id: rootMessage.id,
      root: rootMessage,
      replies: replies,
      replyCount: replies.length,
      counts: counts,
      participants: participants,
      broadcast: rootMessage.to.indexOf("*") !== -1,
      openedAtMs: rootMessage.createdAtMs,
      updatedAtMs: updatedAtMs,
      expired: isExpired(rootMessage, now),
    };
    thread.status = threadStatus(thread, now);
    return thread;
  }

  /**
   * Máquina de estados del hilo (criterio 4):
   *   pending → accepted | declined | partial → completed
   *
   * `completed` exige una señal de cierre (el que pidió responde STATUS /
   * ANSWER / NOTICE en el hilo) o que el pedido haya vencido (TTL del bus):
   * no se marca completado solo porque alguien dijo "acepto".
   */
  function threadStatus(thread, now) {
    var replies = thread.replies || [];
    var has = function (kind) {
      for (var i = 0; i < replies.length; i += 1) if (replies[i].kind === kind) return true;
      return false;
    };
    var anyResponse = has("HELP_ACCEPT") || has("HELP_PARTIAL") || has("HELP_DECLINE");
    var closed = false;
    for (var i = 0; i < replies.length; i += 1) {
      if (CLOSURE_SET[replies[i].kind]) {
        closed = true;
        break;
      }
    }
    var expired = Number.isFinite(now) ? now > thread.root.expiresAtMs : isExpired(thread.root);

    if (closed || (anyResponse && expired)) return "completed";
    if (has("HELP_ACCEPT")) return "accepted";
    if (has("HELP_PARTIAL")) return "partial";
    if (has("HELP_DECLINE")) return "declined";
    return "pending";
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status;
  }

  function kindLabel(kind) {
    return KIND_LABELS[kind] || String(kind || "");
  }

  // ------------------------------------------------------------- búsqueda

  function threadSearchText(thread) {
    var parts = [thread.root.subject, thread.root.from, bodyText(thread.root.body)];
    for (var i = 0; i < thread.replies.length; i += 1) {
      parts.push(thread.replies[i].from, thread.replies[i].subject, bodyText(thread.replies[i].body));
    }
    return fold(parts.join(" \u00b7 "));
  }

  function filterThreads(threads, filters) {
    var f = filters || {};
    var status = str(f.status) || "all";
    var agent = str(f.agent);
    var query = fold(str(f.query));
    var onlyPending = f.onlyPending === true;

    return threads.filter(function (thread) {
      if (status !== "all" && thread.status !== status) return false;
      if (agent && thread.participants.indexOf(agent) === -1) return false;
      if (onlyPending && thread.status !== "pending") return false;
      if (query && threadSearchText(thread).indexOf(query) === -1) return false;
      return true;
    });
  }

  function statusCounts(threads) {
    var counts = { all: threads.length, pending: 0, accepted: 0, declined: 0, partial: 0, completed: 0 };
    for (var i = 0; i < threads.length; i += 1) {
      var status = threads[i].status;
      if (counts[status] === undefined) counts[status] = 0;
      counts[status] += 1;
    }
    return counts;
  }

  /**
   * Mensajes nuevos respecto de un snapshot previo (criterio 6).
   * Devuelve solo lo que no se había visto, con el hilo al que pertenece y si
   * ese hilo está abierto, para que la ARIA live region anuncie únicamente
   * novedades de hilos visibles.
   */
  function newMessages(previousIds, threads, options) {
    var opts = options || {};
    var seen = previousIds || Object.create(null);
    var openThreads = opts.openThreads || null;
    var out = [];

    for (var i = 0; i < threads.length; i += 1) {
      var thread = threads[i];
      var threadOpen = openThreads ? openThreads[thread.id] === true : true;
      var items = [thread.root].concat(thread.replies);
      for (var j = 0; j < items.length; j += 1) {
        var m = items[j];
        if (seen[m.id]) continue;
        if (opts.onlyOpen && !threadOpen) continue;
        out.push({
          threadId: thread.id,
          message: m,
          isRoot: m.id === thread.id,
          threadOpen: threadOpen,
          status: thread.status,
        });
      }
    }
    return out.sort(function (a, b) {
      return a.message.createdAtMs - b.message.createdAtMs;
    });
  }

  function announcementFor(entry) {
    var m = entry.message;
    var who = m.from;
    if (entry.isRoot) {
      return "Nuevo pedido de ayuda de " + who + ": " + shortText(bodyText(m.body), 90);
    }
    return kindLabel(m.kind) + " de " + who + " en hilo de " + (entry.subject || m.subject || "ayuda") +
      ": " + shortText(bodyText(m.body), 90);
  }

  function idsMap(messages) {
    var map = Object.create(null);
    for (var i = 0; i < messages.length; i += 1) map[messages[i].id] = true;
    return map;
  }

  // -------------------------------------------------------------- formato

  function relativeTime(iso, now) {
    var t = parseTime(iso);
    if (!Number.isFinite(t)) return "\u2014";
    var ref = Number.isFinite(now) ? now : Date.now();
    var diff = ref - t;
    if (diff < 0) {
      var ahead = Math.round(-diff / 1000);
      return "en " + ahead + "s";
    }
    var sec = Math.floor(diff / 1000);
    if (sec < 5) return "ahora";
    if (sec < 60) return "hace " + sec + "s";
    var min = Math.floor(sec / 60);
    if (min < 60) return "hace " + min + "m";
    var hour = Math.floor(min / 60);
    if (hour < 24) return "hace " + hour + "h";
    var day = Math.floor(hour / 24);
    if (day < 30) return "hace " + day + "d";
    var month = Math.floor(day / 30);
    if (month < 12) return "hace " + month + "mes";
    return "hace " + Math.floor(month / 12) + "a";
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /** Hora local HH:MM:SS. */
  function formatClock(iso) {
    var t = parseTime(iso);
    if (!Number.isFinite(t)) return "--:--:--";
    var d = new Date(t);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  function formatDateTime(iso) {
    var t = parseTime(iso);
    if (!Number.isFinite(t)) return "\u2014";
    var d = new Date(t);
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  function shortText(text, max) {
    var limit = Number.isFinite(max) ? max : 120;
    var flat = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (flat.length <= limit) return flat;
    return flat.slice(0, Math.max(0, limit - 1)).trimEnd() + "\u2026";
  }

  // -------------------------------------------------------------- agentes

  /** Iniciales para el avatar: "e-testing-api-tester" → "TA", "API Tester" → "AT". */
  function initials(name) {
    var raw = String(name == null ? "" : name).replace(/^e-/, "").trim();
    if (!raw) return "?";
    var words = raw.split(/[-_\s.@/]+/).filter(function (w) {
      return w.length > 0;
    });
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }

  /** Hue estable por agente (0-359) para colorear avatares sin lista fija. */
  function agentHue(agentId) {
    var text = String(agentId == null ? "" : agentId);
    var hash = 0;
    for (var i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) % 360;
    }
    return hash;
  }

  // ---------------------------------------------------------------- cuerpo

  function valueToText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return typeof item === "string" ? item : JSON.stringify(item);
      }).join("\n");
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return String(value);
    }
  }

  /**
   * Convierte el body del mensaje en pares legibles y ordenados.
   * Las claves conocidas van primero (need, why_me, ...) y el resto alfabético,
   * para que un cuerpo con campos nuevos no se pierda ni desordene la lectura.
   */
  function describeBody(body) {
    if (!isObject(body)) return [];
    var keys = Object.keys(body);
    var known = BODY_ORDER.filter(function (key) {
      return Object.prototype.hasOwnProperty.call(body, key);
    });
    var rest = keys.filter(function (key) {
      return BODY_ORDER.indexOf(key) === -1;
    }).sort();
    var ordered = known.concat(rest);
    var out = [];
    for (var i = 0; i < ordered.length; i += 1) {
      var key = ordered[i];
      var text = valueToText(body[key]);
      if (!text) continue;
      out.push({ key: key, label: BODY_LABELS[key] || key, text: text });
    }
    return out;
  }

  function bodyText(body) {
    var parts = describeBody(body).map(function (part) {
      return part.label + ": " + part.text;
    });
    return parts.join(" \u00b7 ");
  }

  /** Clave que identifica el contenido (para no re-renderizar de más). */
  function threadSignature(thread) {
    return thread.id + "|" + thread.status + "|" + thread.replyCount + "|" +
      thread.replies.map(function (m) {
        return m.id;
      }).join(",");
  }

  function snapshotSignature(threads) {
    return threads.map(threadSignature).join(";");
  }

  // ------------------------------------------------------ snapshot de datos

  /**
   * Normaliza cualquier snapshot tolerando formatos: `{messages:[...]}`,
   * `[...]` suelto, o un mensaje único. Devuelve avisos en vez de explotar:
   * un archivo roto no puede tumbar el panel.
   */
  function readSnapshot(payload) {
    var result = { messages: [], agents: {}, cards: {}, acks: {}, meta: {}, warnings: [] };
    if (payload == null) {
      result.warnings.push("snapshot vacío");
      return result;
    }

    var container = payload;
    if (Array.isArray(payload)) {
      result.messages = payload;
    } else if (isObject(payload)) {
      if (Array.isArray(payload.messages)) {
        result.messages = payload.messages;
      } else if (isObject(payload.messages)) {
        result.messages = Object.keys(payload.messages).map(function (key) {
          return payload.messages[key];
        });
      } else if (payload.id && payload.kind) {
        result.messages = [payload];
      } else if (Array.isArray(payload.files)) {
        for (var i = 0; i < payload.files.length; i += 1) {
          var file = payload.files[i];
          if (isObject(file) && file.message) result.messages.push(file.message);
          else if (isObject(file)) result.messages.push(file);
        }
      } else {
        result.warnings.push("el snapshot no tiene mensajes");
      }

      if (isObject(payload.agents)) result.agents = payload.agents;
      if (isObject(payload.cards)) result.cards = payload.cards;
      if (isObject(payload.acks)) result.acks = payload.acks;

      var meta = {};
      var metaKeys = ["generatedAt", "channels", "run", "objective", "status", "root", "ttlSec"];
      for (var k = 0; k < metaKeys.length; k += 1) {
        if (payload[metaKeys[k]] !== undefined) meta[metaKeys[k]] = payload[metaKeys[k]];
      }
      result.meta = meta;
    } else {
      result.warnings.push("snapshot con formato desconocido");
      return result;
    }

    var valid = [];
    for (var m = 0; m < result.messages.length; m += 1) {
      var normalized = normalizeMessage(result.messages[m], result.messages[m] && result.messages[m].channel);
      if (normalized) valid.push(normalized);
      else result.warnings.push("mensaje descartado (sin id o createdAt válido)");
    }
    result.messages = dedupeMessages(valid);
    return result;
  }

  function ackedBy(acks, messageId) {
    var list = acks && acks[messageId];
    if (!Array.isArray(list)) return [];
    return list.map(function (entry) {
      return typeof entry === "string" ? entry : entry && entry.agentId;
    }).filter(Boolean);
  }

  var api = {
    RESPONSE_KINDS: RESPONSE_KINDS,
    CLOSURE_KINDS: CLOSURE_KINDS,
    STATUS_LABELS: STATUS_LABELS,
    KIND_LABELS: KIND_LABELS,
    BODY_LABELS: BODY_LABELS,
    DEFAULT_TTL_SEC: DEFAULT_TTL_SEC,
    normalizeMessage: normalizeMessage,
    isBroadcastHelpRequest: isBroadcastHelpRequest,
    isDebateRoot: isDebateRoot,
    isExpired: isExpired,
    dedupeMessages: dedupeMessages,
    buildThreads: buildThreads,
    threadStatus: threadStatus,
    statusLabel: statusLabel,
    kindLabel: kindLabel,
    filterThreads: filterThreads,
    statusCounts: statusCounts,
    newMessages: newMessages,
    announcementFor: announcementFor,
    idsMap: idsMap,
    relativeTime: relativeTime,
    formatClock: formatClock,
    formatDateTime: formatDateTime,
    shortText: shortText,
    initials: initials,
    agentHue: agentHue,
    describeBody: describeBody,
    bodyText: bodyText,
    threadSignature: threadSignature,
    snapshotSignature: snapshotSignature,
    readSnapshot: readSnapshot,
    ackedBy: ackedBy,
    escapeHtml: escapeHtml,
    threadSearchText: threadSearchText,
  };

  root.DebateCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
