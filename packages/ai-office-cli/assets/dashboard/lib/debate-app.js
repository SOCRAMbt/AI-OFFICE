/*
 * debate-app.js — render e interacción del panel de debate (T-05).
 *
 * Responsabilidades: leer el snapshot (live / archivos / demo), construir los
 * hilos con DebateCore, pintar burbujas anidadas, dejar el estado visible en el
 * DOM y anunciar novedades por una ARIA live region. Toda la lógica de datos
 * vive en debate-core.js (testeada); acá sólo hay DOM.
 */
(function (root, document) {
  "use strict";

  var Core = root.DebateCore;
  var Data = root.DebateData;
  if (!Core || !Data) {
    if (document && document.body) {
      document.body.textContent = "Faltan debate-core.js o debate-data.js.";
    }
    return;
  }

  var POLL_MS = 1000;
  var MAX_BACKOFF_MS = 15000;
  var LONG_TEXT = 220;

  var state = {
    mode: "server",
    apiBase: "",
    srcUrl: null,
    reason: "",
    snapshot: Core.readSnapshot(null),
    built: { threads: [], unlinked: [], messages: [] },
    open: new Set(),
    closed: new Set(),
    expanded: new Set(),
    seen: Object.create(null),
    filters: { status: "all", query: "", agent: "" },
    paused: false,
    loadedOnce: false,
    lastUpdateAt: null,
    lastSignature: "",
    backoff: POLL_MS,
    error: null,
    focusKey: null,
    timer: null,
    demo: false,
  };

  var ui = {};

  // ------------------------------------------------------------- DOM utils

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = String(value);
        else if (key === "style") node.setAttribute("style", value);
        else if (key === "dataset") {
          Object.keys(value).forEach(function (dataKey) {
            node.dataset[dataKey] = String(value[dataKey]);
          });
        } else if (value === true) node.setAttribute(key, "");
        else node.setAttribute(key, String(value));
      });
    }
    for (var i = 2; i < arguments.length; i += 1) {
      appendChild(node, arguments[i]);
    }
    return node;
  }

  function appendChild(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (item) {
        appendChild(parent, item);
      });
      return;
    }
    if (typeof child === "string" || typeof child === "number") {
      parent.appendChild(document.createTextNode(String(child)));
      return;
    }
    parent.appendChild(child);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function safeId(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  function agentInfo(agentId) {
    var fromSnapshot = state.snapshot.agents && state.snapshot.agents[agentId];
    if (fromSnapshot) {
      return {
        id: agentId,
        name: fromSnapshot.displayName || fromSnapshot.role || agentId,
        role: fromSnapshot.role || "",
        state: fromSnapshot.state || "",
      };
    }
    return { id: agentId, name: agentId, role: "", state: "" };
  }

  function cardTitle(subject) {
    var card = state.snapshot.cards && state.snapshot.cards[subject];
    return card && card.title ? card.title : "";
  }

  function avatar(agentId, small) {
    var info = agentInfo(agentId);
    return h(
      "span",
      {
        class: "avatar" + (small ? " avatar-sm" : ""),
        style: "--h:" + Core.agentHue(agentId),
        title: info.name + (info.role ? " (" + info.role + ")" : ""),
        "aria-hidden": "true",
      },
      Core.initials(info.name),
    );
  }

  function timeNode(iso, extraClass) {
    return h("time", {
      class: "time" + (extraClass ? " " + extraClass : ""),
      datetime: iso,
      "data-ts": iso,
      title: Core.formatDateTime(iso),
      text: Core.relativeTime(iso, Date.now()),
    });
  }

  // ------------------------------------------------------------ snapshot

  function applySnapshot(snapshot, options) {
    var opts = options || {};
    var previousSignature = state.lastSignature;
    state.snapshot = snapshot;
    state.built = Core.buildThreads(snapshot.messages || [], { now: Date.now() });
    state.lastUpdateAt = Date.now();
    state.error = null;
    state.demo = !!(snapshot.meta && (snapshot.meta.source === "demo" || snapshot.demo));

    var fresh = [];
    if (state.loadedOnce) {
      fresh = Core.newMessages(state.seen, state.built.threads, {
        onlyOpen: true,
        openThreads: openMap(),
      });
    }
    var seen = Object.create(null);
    Object.keys(state.seen).forEach(function (id) {
      seen[id] = true;
    });
    Object.keys(Core.idsMap(state.built.messages)).forEach(function (id) {
      seen[id] = true;
    });
    state.seen = seen;

    if (!state.loadedOnce) {
      state.loadedOnce = true;
      // Primer pintado: abrimos lo que está vivo para que se vea el debate.
      state.built.threads.forEach(function (thread) {
        if (thread.status !== "completed" && state.open.size < 3) state.open.add(thread.id);
      });
    }

    syncAgentFilter();
    var signature = Core.snapshotSignature(state.built.threads) + "|" + state.built.unlinked.length;
    if (signature !== previousSignature) {
      state.lastSignature = signature;
      render();
    } else {
      renderStats();
      renderConnection();
      renderTimes();
    }

    if (fresh.length > 0) {
      announce(fresh.slice(0, 3).map(Core.announcementFor).join(". "));
    }
    if (opts.notice) announce(opts.notice, true);
  }

  function openMap() {
    var map = Object.create(null);
    state.built.threads.forEach(function (thread) {
      map[thread.id] = isOpen(thread);
    });
    return map;
  }

  function isOpen(thread) {
    if (state.closed.has(thread.id)) return false;
    if (state.open.has(thread.id)) return true;
    return thread.status !== "completed";
  }

  // ------------------------------------------------------------- anuncios

  function announce(text, assertive) {
    if (!text || !ui.live) return;
    ui.live.setAttribute("aria-live", assertive ? "assertive" : "polite");
    // Forzar el re-anuncio cuando el texto se repite.
    ui.live.textContent = "";
    var message = text;
    setTimeout(function () {
      if (ui.live) ui.live.textContent = message;
    }, 60);
  }

  // -------------------------------------------------------------- render

  function render() {
    renderConnection();
    renderStats();
    renderFilters();
    renderBanner();
    renderThreads();
    renderFooter();
  }

  function renderConnection() {
    if (!ui.conn) return;
    var label = "en vivo";
    var tone = "live";
    if (state.mode === "demo") {
      label = "demo";
      tone = "demo";
    } else if (state.mode === "files") {
      label = "archivos";
      tone = "files";
    } else if (state.paused) {
      label = "pausado";
      tone = "paused";
    } else if (state.error) {
      label = "sin conexión";
      tone = "error";
    }
    ui.conn.textContent = label;
    ui.conn.className = "conn conn-" + tone;
    ui.conn.setAttribute(
      "title",
      state.mode === "server"
        ? "Leyendo /api/debate de " + (state.apiBase || location.origin) + " cada " + POLL_MS + "ms"
        : state.mode === "files"
          ? "Datos cargados desde archivos JSON locales"
          : "Datos sintéticos de demostración",
    );
    if (ui.updated) {
      ui.updated.textContent = state.lastUpdateAt
        ? "actualizado " + Core.relativeTime(new Date(state.lastUpdateAt).toISOString(), Date.now())
        : "sin datos";
    }
    if (ui.pauseBtn) {
      ui.pauseBtn.setAttribute("aria-pressed", String(state.paused));
      ui.pauseBtn.textContent = state.paused ? "Reanudar" : "Pausar";
      ui.pauseBtn.disabled = state.mode !== "server";
    }
  }

  function renderStats() {
    var counts = Core.statusCounts(state.built.threads);
    if (ui.statAll) ui.statAll.textContent = String(counts.all);
    if (ui.statPending) ui.statPending.textContent = String(counts.pending);
    if (ui.statProgress) ui.statProgress.textContent = String(counts.accepted + counts.partial);
    if (ui.statDone) ui.statDone.textContent = String(counts.completed);
    if (ui.statDeclined) ui.statDeclined.textContent = String(counts.declined);
    if (ui.countLabel) {
      var replies = state.built.threads.reduce(function (total, thread) {
        return total + thread.replyCount;
      }, 0);
      ui.countLabel.textContent =
        counts.all + (counts.all === 1 ? " hilo" : " hilos") + " · " + replies + (replies === 1 ? " respuesta" : " respuestas") +
        (state.built.unlinked.length ? " · " + state.built.unlinked.length + " sin hilo" : "");
    }
    if (ui.statusFilter) {
      var options = [["all", "Todos"], ["pending", "Esperando"], ["accepted", "Aceptados"], ["partial", "Parciales"], ["declined", "Rechazados"], ["completed", "Completados"]];
      options.forEach(function (pair) {
        var option = ui.statusFilter.querySelector('option[value="' + pair[0] + '"]');
        if (option) option.textContent = pair[1] + " (" + (counts[pair[0]] || 0) + ")";
      });
    }
  }

  function syncAgentFilter() {
    if (!ui.agentFilter) return;
    var current = ui.agentFilter.value;
    var agents = Object.create(null);
    state.built.threads.forEach(function (thread) {
      thread.participants.forEach(function (id) {
        agents[id] = agentInfo(id).name;
      });
    });
    var ids = Object.keys(agents).sort();
    clear(ui.agentFilter);
    appendChild(ui.agentFilter, h("option", { value: "", text: "Todos los agentes" }));
    ids.forEach(function (id) {
      appendChild(ui.agentFilter, h("option", { value: id, text: agents[id] + " (" + id + ")" }));
    });
    ui.agentFilter.value = ids.indexOf(current) !== -1 ? current : "";
    state.filters.agent = ui.agentFilter.value;
  }

  function renderFilters() {
    if (!ui.queryInput) return;
    if (document.activeElement !== ui.queryInput) ui.queryInput.value = state.filters.query;
    ui.queryInput.setAttribute("aria-label", "Buscar en hilos y respuestas");
  }

  function renderThreads() {
    if (!ui.list) return;
    clear(ui.list);

    var visible = Core.filterThreads(state.built.threads, state.filters);
    if (ui.countLabel) {
      var counts = Core.statusCounts(state.built.threads);
      var replies = state.built.threads.reduce(function (total, thread) {
        return total + thread.replyCount;
      }, 0);
      ui.countLabel.textContent =
        counts.all + (counts.all === 1 ? " hilo" : " hilos") + " · " + replies + (replies === 1 ? " respuesta" : " respuestas") +
        (visible.length !== counts.all ? " · mostrando " + visible.length : "") +
        (state.built.unlinked.length ? " · " + state.built.unlinked.length + " sin hilo" : "");
    }

    ui.list.setAttribute("aria-busy", "false");
    ui.list.hidden = visible.length === 0;
    if (ui.empty) ui.empty.hidden = visible.length !== 0;
    if (visible.length === 0 && ui.empty) renderEmpty();

    visible.forEach(function (thread, index) {
      appendChild(ui.list, threadNode(thread, index));
    });
    restoreFocus();
    renderTimes();
  }

  function renderEmpty() {
    clear(ui.empty);
    var hasData = state.built.threads.length > 0;
    appendChild(
      ui.empty,
      h(
        "div",
        { class: "empty-card" },
        h("h2", { text: hasData ? "Ningún hilo coincide" : "No hay pedidos de ayuda broadcast todavía" }),
        h(
          "p",
          {
            text: hasData
              ? "Ajustá el filtro o el texto de búsqueda."
              : "El panel muestra HELP_REQUEST dirigidos a ['*'] y sus respuestas. Cuando alguno aparezca en el bus, se abre el hilo acá.",
          },
        ),
        h(
          "div",
          { class: "empty-actions" },
          h("button", { class: "ghost", type: "button", "data-action": "clear-filters", text: "Limpiar filtros" }),
          state.mode === "files"
            ? h("button", { class: "ghost", type: "button", "data-action": "pick-files", text: "Cargar JSON del bus" })
            : null,
          h("button", { class: "ghost", type: "button", "data-action": "demo", text: "Ver datos de demo" }),
        ),
        h("pre", { class: "empty-cmd", text: "node dashboard/server.mjs\n# → http://127.0.0.1:7788/debate.html" }),
      ),
    );
  }

  function renderFooter() {
    if (!ui.footer) return;
    clear(ui.footer);
    var meta = state.snapshot.meta || {};
    var parts = [];
    if (meta.generatedAt) parts.push("snapshot " + Core.formatClock(meta.generatedAt));
    if (meta.objective) parts.push(Core.shortText(meta.objective, 80));
    if (Array.isArray(meta.channels) && meta.channels.length) parts.push("canales: " + meta.channels.join(", "));
    parts.push(state.built.messages.length + " mensajes indexados");
    appendChild(ui.footer, h("span", { text: parts.join(" · ") }));

    var warnings = (state.snapshot.warnings || []).slice(0, 3);
    if (warnings.length) {
      appendChild(
        ui.footer,
        h("span", {
          class: "warn-inline",
          text: "⚠ " + warnings.length + " aviso(s): " + warnings.join(" · "),
        }),
      );
    }
  }

  function renderBanner() {
    if (!ui.banner) return;
    clear(ui.banner);
    var show = null;
    if (state.mode === "demo") {
      show = {
        tone: "info",
        text: "Estás viendo datos de DEMO (sintéticos). Para leer la corrida real, abrí el panel con el server local.",
      };
    } else if (state.mode === "files") {
      show = {
        tone: "info",
        text: "Modo archivos: file:// no puede leer .oficina/. Soltá los JSON de .oficina/bus/peer/ (o corré node dashboard/server.mjs para verlo en vivo).",
        actions: [
          { label: "Elegir archivos", action: "pick-files" },
          { label: "Ver demo", action: "demo" },
        ],
      };
    } else if (state.error) {
      show = {
        tone: "error",
        text: "No pude leer /api/debate: " + state.error + ". Reintentando cada " + Math.round(state.backoff / 1000) + "s.",
        actions: [
          { label: "Reintentar ahora", action: "reload" },
          { label: "Cargar JSON", action: "pick-files" },
        ],
      };
    }
    if (!show) {
      ui.banner.hidden = true;
      return;
    }
    ui.banner.hidden = false;
    ui.banner.className = "banner banner-" + show.tone;
    ui.banner.appendChild(h("p", { text: show.text }));
    if (show.actions) {
      var group = h("div", { class: "banner-actions" });
      show.actions.forEach(function (item) {
        appendChild(
          group,
          h("button", { class: "ghost", type: "button", "data-action": item.action, text: item.label }),
        );
      });
      ui.banner.appendChild(group);
    }
  }

  function renderTimes() {
    if (!ui.list) return;
    var nodes = ui.list.querySelectorAll("time[data-ts]");
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].textContent = Core.relativeTime(nodes[i].dataset.ts, Date.now());
    }
    if (ui.updated && state.lastUpdateAt) {
      ui.updated.textContent =
        "actualizado " + Core.relativeTime(new Date(state.lastUpdateAt).toISOString(), Date.now());
    }
  }

  // -------------------------------------------------------------- hilo

  function statusPill(status) {
    return h("span", {
      class: "pill pill-" + status,
      title: "Estado del hilo: " + Core.statusLabel(status),
      text: Core.statusLabel(status),
    });
  }

  function stepsNode(thread) {
    var replied = thread.replyCount > 0;
    var responseLabel = replied
      ? thread.status === "declined"
        ? "Rechazado"
        : thread.status === "partial"
          ? "Parcial"
          : "Aceptado"
      : "Respuesta";
    var steps = [
      { label: "Pedido", done: true, active: false },
      {
        label: responseLabel,
        done: replied,
        active: !replied,
      },
      {
        label: "Cierre",
        done: thread.status === "completed",
        active: thread.status === "accepted" || thread.status === "partial" || thread.status === "declined",
      },
    ];
    var list = h("ol", { class: "steps", "aria-label": "Progreso del hilo" });
    steps.forEach(function (step) {
      var classes = "step" + (step.done ? " is-done" : "") + (step.active ? " is-active" : "");
      var attrs = { class: classes };
      if (step.active) attrs["aria-current"] = "step";
      appendChild(list, h("li", attrs, h("span", { class: "dot", "aria-hidden": "true" }), step.label));
    });
    return list;
  }

  function threadNode(thread, index) {
    var id = safeId(thread.id);
    var open = isOpen(thread);
    var root = thread.root;
    var info = agentInfo(root.from);
    var need = Core.describeBody(root.body).find(function (part) {
      return part.key === "need";
    });
    var preview = need ? need.text : Core.bodyText(root.body);
    var acked = Core.ackedBy(state.snapshot.acks, root.id);
    var card = cardTitle(root.subject);

    var article = h("article", {
      class: "thread status-" + thread.status,
      "data-thread-id": thread.id,
      "data-fkey": "thread:" + thread.id,
      "aria-labelledby": "h-" + id,
      style: "--h:" + Core.agentHue(root.from),
    });

    var toggle = h(
      "button",
      {
        class: "thread-toggle",
        type: "button",
        id: "h-" + id,
        "aria-expanded": String(open),
        "aria-controls": "b-" + id,
        "data-action": "toggle-thread",
        "data-fkey": "toggle:" + thread.id,
      },
      avatar(root.from, false),
      h(
        "span",
        { class: "thread-main" },
        h(
          "span",
          { class: "thread-title" },
          h("span", { class: "who", text: info.name }),
          h("span", { class: "sep", "aria-hidden": "true", text: "·" }),
          h("span", { class: "subject", text: root.subject || "sin card" }),
          thread.broadcast
            ? h("span", { class: "tag tag-broadcast", title: "HELP_REQUEST dirigido a todos", text: "broadcast" })
            : h("span", { class: "tag", title: "HELP_REQUEST a varios agentes", text: "multi" }),
          root.priority === "critical" || root.priority === "high"
            ? h("span", { class: "tag tag-" + root.priority, text: root.priority })
            : null,
        ),
        h("span", { class: "thread-need", text: preview || "sin detalle" }),
        card ? h("span", { class: "thread-card", text: card }) : null,
      ),
      h(
        "span",
        { class: "thread-meta" },
        statusPill(thread.status),
        h("span", {
          class: "reply-count",
          title: thread.replyCount === 1 ? "1 respuesta" : thread.replyCount + " respuestas",
          text: "💬 " + thread.replyCount,
        }),
        timeNode(root.createdAt),
        h("span", { class: "chev", "aria-hidden": "true" }),
      ),
    );

    var body = h("div", {
      class: "thread-body",
      id: "b-" + id,
      role: "group",
      "aria-label": "Debate sobre " + (root.subject || "ayuda"),
    });
    body.hidden = !open;

    appendChild(body, stepsNode(thread));
    appendChild(body, requestNode(thread, acked));
    appendChild(body, repliesNode(thread));

    appendChild(article, h("h3", { class: "thread-heading" }, toggle));
    appendChild(article, body);
    article.dataset.index = String(index);
    return article;
  }

  function requestNode(thread, acked) {
    var root = thread.root;
    var parts = Core.describeBody(root.body);
    var wrap = h("section", { class: "request", "aria-label": "Pedido de ayuda" });
    appendChild(
      wrap,
      h(
        "header",
        { class: "request-head" },
        avatar(root.from, true),
        h("span", { class: "bname", text: agentInfo(root.from).name }),
        h("span", { class: "badge badge-request", text: "pide ayuda" }),
        timeNode(root.createdAt, "muted"),
        h("span", { class: "muted", text: "→ " + root.to.join(", ") }),
      ),
    );
    if (parts.length === 0) {
      appendChild(wrap, h("p", { class: "muted", text: "(el pedido no trae cuerpo)" }));
    } else {
      parts.forEach(function (part) {
        appendChild(wrap, bodyPartNode(thread, root, part));
      });
    }
    appendChild(
      wrap,
      h(
        "footer",
        { class: "request-foot" },
        h("span", { class: "muted", text: "ttl " + Math.round(root.ttlSec / 60) + "m" }),
        thread.expired ? h("span", { class: "tag tag-expired", text: "vencido" }) : null,
        h("span", { class: "muted", text: "id " + root.id }),
        h("span", {
          class: "muted",
          text: acked.length ? "visto por " + acked.length + ": " + acked.map(shortAgent).join(", ") : "sin acuses",
        }),
        h("details", { class: "json" }, h("summary", { text: "JSON" }), h("pre", { text: JSON.stringify(root, null, 2) })),
      ),
    );
    return wrap;
  }

  function shortAgent(agentId) {
    return agentInfo(agentId).name;
  }

  function bodyPartNode(thread, message, part) {
    var key = thread.id + ":" + message.id + ":" + part.key;
    var expanded = state.expanded.has(key);
    var isLong = part.text.length > LONG_TEXT || part.text.indexOf("\n") !== -1;
    var wrap = h("div", { class: "part" });
    appendChild(wrap, h("span", { class: "part-label", text: part.label }));
    appendChild(
      wrap,
      h("div", {
        class: "part-value" + (isLong ? " is-long" : "") + (expanded ? " is-expanded" : ""),
        text: part.text,
      }),
    );
    if (isLong) {
      appendChild(
        wrap,
        h("button", {
          class: "more",
          type: "button",
          "data-action": "expand-body",
          "data-key": key,
          "data-fkey": "more:" + key,
          "aria-expanded": String(expanded),
          text: expanded ? "Ver menos" : "Ver completo",
        }),
      );
    }
    return wrap;
  }

  function repliesNode(thread) {
    var section = h("section", { class: "replies", "aria-label": "Respuestas al pedido" });
    appendChild(
      section,
      h("h4", {
        class: "replies-title",
        text: thread.replyCount === 1 ? "1 respuesta" : thread.replyCount + " respuestas",
      }),
    );

    if (thread.replyCount === 0) {
      appendChild(
        section,
        h("p", {
          class: "muted empty-replies",
          text: "Todavía nadie contestó. " +
            (thread.expired ? "El pedido ya venció por TTL." : "Vence " + Core.relativeTime(new Date(thread.root.expiresAtMs).toISOString(), state.lastUpdateAt || Date.now()) + "."),
        }),
      );
      return section;
    }

    var list = h("ol", { class: "bubbles" });
    thread.replies.forEach(function (message) {
      appendChild(list, bubbleNode(thread, message));
    });
    appendChild(section, list);
    return section;
  }

  function bubbleNode(thread, message) {
    var info = agentInfo(message.from);
    var parts = Core.describeBody(message.body);
    var bubble = h("li", {
      class: "bubble kind-" + message.kind.toLowerCase().replace(/_/g, "-"),
      "data-message-id": message.id,
    });

    appendChild(bubble, avatar(message.from, true));
    var content = h("div", { class: "bubble-content" });
    appendChild(
      content,
      h(
        "header",
        { class: "bubble-head" },
        h("span", { class: "bname", text: info.name }),
        h("span", { class: "badge badge-" + message.kind.toLowerCase().replace(/_/g, "-"), text: Core.kindLabel(message.kind) }),
        message.priority === "critical" || message.priority === "high"
          ? h("span", { class: "tag tag-" + message.priority, text: message.priority })
          : null,
        timeNode(message.createdAt, "muted"),
      ),
    );

    if (parts.length === 0) {
      appendChild(content, h("p", { class: "muted", text: "(respuesta sin cuerpo)" }));
    } else {
      parts.forEach(function (part) {
        appendChild(content, bodyPartNode(thread, message, part));
      });
    }

    appendChild(
      content,
      h(
        "footer",
        { class: "bubble-foot" },
        h("span", { class: "muted", text: "→ " + message.to.join(", ") }),
        message.reattached ? h("span", { class: "tag tag-reattached", title: "inReplyTo apuntaba a un mensaje vencido; se enganchó por subject", text: "reenganchado" }) : null,
        h("span", { class: "muted", text: Core.formatClock(message.createdAt) }),
        h("span", { class: "muted", text: "id " + message.id }),
        h("details", { class: "json" }, h("summary", { text: "JSON" }), h("pre", { text: JSON.stringify(message, null, 2) })),
      ),
    );

    appendChild(bubble, content);
    return bubble;
  }

  // ------------------------------------------------------- foco y estado

  /**
   * Recuerda el foco sólo si está dentro de la lista de hilos: es lo único que
   * se recrea en cada render. Si el foco está en el buscador, no se toca.
   */
  function rememberFocus() {
    var active = document.activeElement;
    var inside = !!(active && ui.list && ui.list.contains(active));
    state.focusKey = inside && active.dataset && active.dataset.fkey ? active.dataset.fkey : null;
  }

  function restoreFocus() {
    if (!state.focusKey) return;
    var node = ui.list.querySelector('[data-fkey="' + cssEscape(state.focusKey) + '"]');
    if (node && typeof node.focus === "function") node.focus({ preventScroll: true });
  }

  function cssEscape(value) {
    if (root.CSS && typeof root.CSS.escape === "function") return root.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function toggleThread(threadId, forceOpen) {
    var thread = findThread(threadId);
    if (!thread) return;
    var open = forceOpen === undefined ? !isOpen(thread) : forceOpen;
    if (open) {
      state.closed.delete(threadId);
      state.open.add(threadId);
    } else {
      state.open.delete(threadId);
      state.closed.add(threadId);
    }
    var body = document.getElementById("b-" + safeId(threadId));
    var toggle = document.getElementById("h-" + safeId(threadId));
    if (body) body.hidden = !open;
    if (toggle) toggle.setAttribute("aria-expanded", String(open));
    /* Sin announce: aria-expanded ya lo comunica el lector de pantalla. */
  }

  function findThread(threadId) {
    for (var i = 0; i < state.built.threads.length; i += 1) {
      if (state.built.threads[i].id === threadId) return state.built.threads[i];
    }
    return null;
  }

  function setAllOpen(open) {
    state.built.threads.forEach(function (thread) {
      if (open) {
        state.closed.delete(thread.id);
        state.open.add(thread.id);
      } else {
        state.open.delete(thread.id);
        state.closed.add(thread.id);
      }
    });
    render();
    announce(open ? "Todos los hilos abiertos." : "Todos los hilos cerrados.");
  }

  function toggleBodyKey(key, button) {
    var expanded = state.expanded.has(key);
    if (expanded) state.expanded.delete(key);
    else state.expanded.add(key);
    var value = button.parentNode ? button.parentNode.querySelector(".part-value") : null;
    if (value) value.classList.toggle("is-expanded", !expanded);
    button.setAttribute("aria-expanded", String(!expanded));
    button.textContent = expanded ? "Ver completo" : "Ver menos";
  }

  // --------------------------------------------------------- carga de datos

  function schedule(delay) {
    if (state.timer) clearTimeout(state.timer);
    if (state.mode !== "server" && state.mode !== "snapshot") return;
    state.timer = setTimeout(function () {
      poll(false);
    }, delay == null ? POLL_MS : delay);
  }

  function poll(force) {
    if (state.mode !== "server" && state.mode !== "snapshot") return;
    if (!force && (state.paused || document.hidden)) {
      schedule(POLL_MS);
      return;
    }
    ensureBusy(true);
    var request = state.mode === "server" ? Data.loadFromServer(state.apiBase) : Data.loadFromUrl(state.srcUrl);
    request
      .then(function (snapshot) {
        state.backoff = POLL_MS;
        applySnapshot(snapshot);
      })
      .catch(function (error) {
        state.error = String(error && error.message ? error.message : error);
        state.backoff = Math.min(state.backoff * 2, MAX_BACKOFF_MS);
        renderConnection();
        renderBanner();
      })
      .finally(function () {
        ensureBusy(false);
        schedule(state.backoff);
      });
  }

  function ensureBusy(busy) {
    if (ui.list) ui.list.setAttribute("aria-busy", busy ? "true" : "false");
    if (ui.conn) ui.conn.classList.toggle("is-loading", busy);
  }

  function loadDemo() {
    stopPolling();
    state.mode = "demo";
    var snapshot = Core.readSnapshot(root.DebateDemo ? root.DebateDemo() : { messages: [] });
    snapshot.meta.source = "demo";
    snapshot.meta.demo = true;
    state.loadedOnce = true; // no anunciar el pasado como si fuera nuevo
    applySnapshot(snapshot, { notice: "Datos de demo cargados (sintéticos)." });
    renderBanner();
  }

  function loadFiles(fileList) {
    return Data.readFiles(fileList).then(function (result) {
      if (result.fileCount === 0) return;
      stopPolling();
      state.mode = "files";
      var snapshot = result.snapshot;
      snapshot.meta.source = "files";
      applySnapshot(snapshot, {
        notice:
          "Cargados " + result.fileCount + " archivo(s): " + snapshot.messages.length + " mensajes" +
          (result.errors.length ? ", " + result.errors.length + " con error." : "."),
      });
      if (result.errors.length) {
        state.error = result.errors.map(function (entry) {
          return entry.name + ": " + entry.error;
        }).join(" · ");
        renderBanner();
      }
      renderBanner();
    });
  }

  function stopPolling() {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
  }

  // ------------------------------------------------------------ interacción

  function bindEvents() {
    ui.list.addEventListener("click", function (event) {
      var action = event.target.closest ? event.target.closest("[data-action]") : null;
      if (!action) return;
      var name = action.dataset.action;
      if (name === "toggle-thread") {
        event.preventDefault();
        toggleThread(action.closest("[data-thread-id]").dataset.threadId);
      } else if (name === "expand-body") {
        toggleBodyKey(action.dataset.key, action);
      }
    });

    document.addEventListener("click", function (event) {
      var action = event.target.closest ? event.target.closest("[data-action]") : null;
      if (!action) return;
      var name = action.dataset.action;
      if (name === "reload") poll(true);
      else if (name === "pause") {
        state.paused = !state.paused;
        renderConnection();
        announce(state.paused ? "Actualización pausada." : "Actualización reanudada.");
      } else if (name === "expand-all") setAllOpen(true);
      else if (name === "collapse-all") setAllOpen(false);
      else if (name === "theme") toggleTheme();
      else if (name === "help") openHelp(true);
      else if (name === "close-help") openHelp(false);
      else if (name === "demo") loadDemo();
      else if (name === "pick-files") ui.fileInput.click();
      else if (name === "clear-filters") {
        state.filters = { status: "all", query: "", agent: "" };
        ui.statusFilter.value = "all";
        ui.agentFilter.value = "";
        ui.queryInput.value = "";
        renderThreads();
      }
    });

    ui.queryInput.addEventListener("input", debounce(function () {
      state.filters.query = ui.queryInput.value;
      renderThreads();
    }, 140));

    ui.statusFilter.addEventListener("change", function () {
      state.filters.status = ui.statusFilter.value;
      renderThreads();
    });

    ui.agentFilter.addEventListener("change", function () {
      state.filters.agent = ui.agentFilter.value;
      renderThreads();
    });

    ui.fileInput.addEventListener("change", function () {
      loadFiles(ui.fileInput.files);
      ui.fileInput.value = "";
    });

    // Navegación con flechas entre cabeceras de hilo.
    ui.list.addEventListener("keydown", function (event) {
      var target = event.target;
      if (!target.classList || !target.classList.contains("thread-toggle")) return;
      var toggles = Array.prototype.slice.call(ui.list.querySelectorAll(".thread-toggle"));
      var index = toggles.indexOf(target);
      var next = -1;
      if (event.key === "ArrowDown") next = Math.min(index + 1, toggles.length - 1);
      else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = toggles.length - 1;
      if (next >= 0 && toggles[next] && next !== index) {
        event.preventDefault();
        toggles[next].focus();
      }
    });

    document.addEventListener("keydown", function (event) {
      var target = event.target;
      var tag = (target.tagName || "").toLowerCase();
      var typing = tag === "input" || tag === "select" || tag === "textarea" || target.isContentEditable;
      if (event.key === "Escape") {
        if (ui.help.open) {
          openHelp(false);
          event.preventDefault();
        } else if (typing) {
          target.blur();
        }
        return;
      }
      if (event.key === "/" && !typing) {
        event.preventDefault();
        ui.queryInput.focus();
        ui.queryInput.select();
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "?" ) {
        event.preventDefault();
        openHelp(!ui.help.open);
      } else if (event.key === "r" || event.key === "R") {
        poll(true);
      } else if (event.key === "p" || event.key === "P") {
        state.paused = !state.paused;
        renderConnection();
        announce(state.paused ? "Actualización pausada." : "Actualización reanudada.");
      } else if (event.key === "e" || event.key === "E") {
        setAllOpen(true);
      } else if (event.key === "x" || event.key === "X") {
        setAllOpen(false);
      }
    });

    // Drag & drop de JSON del bus.
    ["dragenter", "dragover"].forEach(function (name) {
      document.addEventListener(name, function (event) {
        if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types || [], "Files") === -1) return;
        event.preventDefault();
        ui.dropzone.hidden = false;
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      document.addEventListener(name, function (event) {
        if (name === "dragleave" && event.relatedTarget) return;
        if (ui.dropzone) ui.dropzone.hidden = true;
      });
    });
    document.addEventListener("drop", function (event) {
      if (!event.dataTransfer || !event.dataTransfer.files || event.dataTransfer.files.length === 0) return;
      event.preventDefault();
      loadFiles(event.dataTransfer.files);
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) poll(true);
    });
  }

  function openHelp(open) {
    if (!ui.help) return;
    if (open) {
      if (typeof ui.help.showModal === "function") ui.help.showModal();
      else ui.help.setAttribute("open", "");
    } else if (typeof ui.help.close === "function") {
      ui.help.close();
    } else {
      ui.help.removeAttribute("open");
    }
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  // ----------------------------------------------------------------- tema

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }

  function toggleTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("oficina.theme", next);
    } catch (err) {
      /* modo privado / file:// sin storage */
    }
    announce("Tema " + (next === "dark" ? "oscuro" : "claro") + ".");
  }

  function initTheme() {
    var stored = null;
    try {
      stored = localStorage.getItem("oficina.theme");
    } catch (err) {
      stored = null;
    }
    var preferred = stored || (root.matchMedia && root.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", preferred);
  }

  // ---------------------------------------------------------------- boot

  function grabUi() {
    ui = {
      list: document.getElementById("threads"),
      empty: document.getElementById("empty"),
      banner: document.getElementById("banner"),
      live: document.getElementById("live"),
      conn: document.getElementById("conn"),
      updated: document.getElementById("updated"),
      countLabel: document.getElementById("count-label"),
      statAll: document.getElementById("stat-all"),
      statPending: document.getElementById("stat-pending"),
      statProgress: document.getElementById("stat-progress"),
      statDone: document.getElementById("stat-done"),
      statDeclined: document.getElementById("stat-declined"),
      queryInput: document.getElementById("filter-q"),
      statusFilter: document.getElementById("filter-status"),
      agentFilter: document.getElementById("filter-agent"),
      fileInput: document.getElementById("file-input"),
      footer: document.getElementById("footer-meta"),
      help: document.getElementById("help"),
      dropzone: document.getElementById("dropzone"),
      pauseBtn: document.querySelector('[data-action="pause"]'),
    };
    state.paused = false;
    return Boolean(ui.list && ui.live);
  }

  function boot() {
    if (!document.getElementById("threads")) return;
    if (!grabUi()) return;
    initTheme();
    bindEvents();

    // Guardar el foco antes de cada re-render (los nodos se recrean).
    document.addEventListener("focusin", rememberFocus);

    var detected = Data.detectMode(root.location);
    state.mode = detected.mode;
    state.apiBase = detected.apiBase || "";
    state.srcUrl = detected.srcUrl;
    state.reason = detected.reason;

    render();
    renderEmpty();

    if (state.mode === "demo") {
      loadDemo();
    } else if (state.mode === "files") {
      state.mode = "server"; // probamos igual: algunos navegadores permiten file://+fetch
      poll(true);
      setTimeout(function () {
        if (state.error) {
          stopPolling();
          state.mode = "files";
          state.error = null;
          render();
          renderBanner();
          announce("Modo archivos: soltá los JSON del bus para ver los hilos.");
        }
      }, 1500);
    } else {
      poll(true);
    }

    // Refresco de "hace X" sin re-renderizar estructuras.
    setInterval(renderTimes, 10000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, document);
