/*
 * debate-data.js — acceso a datos del panel de debate (T-05).
 *
 * Tres fuentes, en orden de preferencia:
 *   1. `server`  → GET /api/debate de dashboard/server.mjs (lectura en vivo de
 *                  .oficina/bus/**. Es la única que ve archivos nuevos.)
 *   2. `snapshot`→ un JSON servido por URL (?src=https://...)
 *   3. `files`   → JSON arrastrados/soltados por el usuario (file:// no puede
 *                  listar directorios ni leer .oficina por CORS)
 *
 * Publica `globalThis.DebateData`. No toca DOM.
 */
(function (root) {
  "use strict";

  var CORE = root.DebateCore;
  var DEFAULT_TIMEOUT_MS = 5000;

  function fetchJson(url, timeoutMs) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = null;
    var options = { cache: "no-store", headers: { Accept: "application/json" } };
    if (controller) options.signal = controller.signal;
    if (controller) {
      timer = setTimeout(function () {
        controller.abort();
      }, timeoutMs || DEFAULT_TIMEOUT_MS);
    }
    return fetch(url, options)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status + " en " + url);
        return res.json();
      })
      .finally(function () {
        if (timer) clearTimeout(timer);
      });
  }

  /**
   * Decide de dónde leer según el entorno y la URL.
   *   ?demo=1      → datos sintéticos (se rotula en la UI)
   *   ?src=<url>   → snapshot JSON estático
   *   ?api=<url>   → base del server local
   *   file://      → archivos soltados a mano
   *   http(s)://   → server local
   */
  function detectMode(locationLike) {
    var loc = locationLike || (typeof location !== "undefined" ? location : { protocol: "http:", search: "" });
    var params = new URLSearchParams(loc.search || "");
    if (params.get("demo") === "1") {
      return { mode: "demo", reason: "?demo=1", apiBase: null, srcUrl: null };
    }
    var src = params.get("src");
    if (src) return { mode: "snapshot", reason: "?src=" + src, apiBase: null, srcUrl: src };

    var api = params.get("api");
    if (api) return { mode: "server", reason: "?api=" + api, apiBase: api.replace(/\/+$/, ""), srcUrl: null };

    if (loc.protocol === "file:") {
      return { mode: "files", reason: "file://", apiBase: null, srcUrl: null };
    }
    return { mode: "server", reason: "mismo origen", apiBase: "", srcUrl: null };
  }

  function loadFromServer(apiBase) {
    var base = apiBase == null ? "" : String(apiBase).replace(/\/+$/, "");
    return fetchJson(base + "/api/debate").then(function (payload) {
      var snapshot = CORE.readSnapshot(payload);
      snapshot.meta = snapshot.meta || {};
      snapshot.meta.source = "server";
      return snapshot;
    });
  }

  function loadFromUrl(url) {
    return fetchJson(url).then(function (payload) {
      var snapshot = CORE.readSnapshot(payload);
      snapshot.meta = snapshot.meta || {};
      snapshot.meta.source = "snapshot";
      snapshot.meta.sourceUrl = url;
      return snapshot;
    });
  }

  /** Combina snapshots parciales (varios archivos sueltos del bus). */
  function mergeSnapshots(list) {
    var merged = { messages: [], agents: {}, cards: {}, acks: {}, meta: {}, warnings: [] };
    for (var i = 0; i < list.length; i += 1) {
      var snapshot = list[i];
      if (!snapshot) continue;
      merged.messages = merged.messages.concat(snapshot.messages || []);
      merged.warnings = merged.warnings.concat(snapshot.warnings || []);
      copyInto(merged.agents, snapshot.agents);
      copyInto(merged.cards, snapshot.cards);
      copyInto(merged.acks, snapshot.acks);
      if (snapshot.meta) {
        for (var key in snapshot.meta) {
          if (Object.prototype.hasOwnProperty.call(snapshot.meta, key)) merged.meta[key] = snapshot.meta[key];
        }
      }
    }
    merged.messages = CORE.dedupeMessages(merged.messages);
    if (!merged.meta.generatedAt) merged.meta.generatedAt = new Date().toISOString();
    merged.meta.source = "files";
    return merged;
  }

  function copyInto(target, source) {
    if (!source) return;
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
    }
  }

  function readText(file) {
    if (file && typeof file.text === "function") return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(reader.error || new Error("no se pudo leer " + (file && file.name)));
      };
      reader.readAsText(file);
    });
  }

  /**
   * Lee archivos JSON soltados. Acepta snapshot completo, un mensaje suelto del
   * bus o un array de mensajes (lo que uno copia de `.oficina/bus/peer/`).
   * Devuelve `errors` por archivo en vez de abortar todo por uno roto.
   */
  function readFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var errors = [];
    var reads = files.map(function (file) {
      return readText(file)
        .then(function (text) {
          var payload = JSON.parse(text);
          return CORE.readSnapshot(payload);
        })
        .catch(function (error) {
          errors.push({ name: file.name, error: String(error && error.message ? error.message : error) });
          return null;
        });
    });

    return Promise.all(reads).then(function (snapshots) {
      var merged = mergeSnapshots(snapshots.filter(Boolean));
      return { snapshot: merged, errors: errors, fileCount: files.length };
    });
  }

  root.DebateData = {
    fetchJson: fetchJson,
    detectMode: detectMode,
    loadFromServer: loadFromServer,
    loadFromUrl: loadFromUrl,
    readFiles: readFiles,
    mergeSnapshots: mergeSnapshots,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
