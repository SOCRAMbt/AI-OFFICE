/**
 * Logging estructurado.
 *
 * El plugin escribe logs con un sink inyectable para que los tests no
 * ensucien stdout y para poder mandar al `client.app.log()` de OpenCode
 * cuando el plugin corre dentro del host.
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogEntry {
  level: LogLevel
  service: string
  message: string
  extra?: Record<string, unknown>
  at: string
}

export type LogSink = (entry: LogEntry) => void

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

let currentSink: LogSink = (entry) => {
  const line = `[${entry.at}] ${entry.level.toUpperCase()} ${entry.service}: ${entry.message}`
  const extra = entry.extra ? ` ${JSON.stringify(entry.extra)}` : ""
  // eslint-disable-next-line no-console
  console.error(line + extra)
}

let currentLevel: LogLevel = "info"

/** Configura el sink y el nivel. */
export function configureLogging(options: { sink?: LogSink; level?: LogLevel }): void {
  if (options.sink) currentSink = options.sink
  if (options.level) currentLevel = options.level
}

/** Crea un logger con scope. */
export function logger(service: string, extra?: Record<string, unknown>) {
  const emit = (level: LogLevel, message: string, more?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return
    currentSink({
      level,
      service,
      message,
      at: new Date().toISOString(),
      extra: { ...extra, ...more },
    })
  }
  return {
    debug: (m: string, e?: Record<string, unknown>) => emit("debug", m, e),
    info: (m: string, e?: Record<string, unknown>) => emit("info", m, e),
    warn: (m: string, e?: Record<string, unknown>) => emit("warn", m, e),
    error: (m: string, e?: Record<string, unknown>) => emit("error", m, e),
  }
}

export type Logger = ReturnType<typeof logger>
