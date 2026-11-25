/**
 * OFICINA — entry point del plugin para **OpenCode v2**.
 *
 * ## Por qué existe este archivo
 *
 * OpenCode v1 y v2 tienen APIs de plugins **incomunes**: no es que
 * cambiara una firma, es que cambió la forma. v1 exportaba una funcion que
 * devuelve hooks; v2 exige `export default { id, setup(ctx) }`. Un plugin
 * v1 bajo v2 falla con:
 *
 *     PluginModule.LoadError: Plugin must export a default definition with
 *     an id and an effect or setup function.
 *
 * Y al reves: un plugin v2 bajo v1 no carga.
 *
 * Este archivo es la implementacion **v2**. La de v1 vive en `v1.ts` y el
 * motor (`core/`, `tools/`) no depende de ninguna de las dos APIs: define
 * las tools en una forma neutra y cada entry la traduce.
 *
 * ## Qué registra (THIN WRAPPER)
 *
 * - Crea **OpenCodeAdapter** y lo inicializa con el contexto
 * - Pasa el adapter a **OfficeFactory** via `host` config
 * - Delega TODA la lógica al adapter: tools, scope guard, tripwire,
 *   dashboard, auto-continuación, context hooks
 *
 * BACKWARD COMPATIBLE: El plugin sigue funcionando IDÉNTICO para usuarios existentes.
 */
import { Plugin } from "@opencode/plugin";
import { OfficeFactory, logger } from "ai-office-core";
import { OpenCodeAdapter } from "ai-office-host-opencode";
const log = logger("oficina:v2");
export default Plugin.define({
    id: "oficina",
    async setup(ctx) {
        const cwd = ctx.location?.directory ?? process.cwd();
        // Create OpenCodeAdapter and initialize with context
        const adapter = new OpenCodeAdapter();
        await adapter.initialize({ projectRoot: cwd });
        adapter.setContext(ctx);
        // Create OfficeFactory with the adapter as host
        const factory = new OfficeFactory({ host: adapter });
        adapter.setOfficeFactory(factory);
        const office = factory.getPrimary(cwd);
        await office.init();
        // Delegate ALL logic to the adapter
        await adapter.registerTools(office);
        await adapter.registerScopeGuardHooks();
        await adapter.registerContextHooks();
        // Start dashboard if enabled
        if (adapter.dashboardEnabled) {
            void (async () => {
                const info = await adapter.ensureDashboard(cwd);
                if (!info)
                    return;
                const state = await office.loadState().catch(() => undefined);
                if (state?.status === "running")
                    adapter.dashboard.openBrowser(info.url);
            })();
        }
        log.info("plugin inicializado (thin wrapper)", {
            directory: cwd,
            officeDir: office.paths.officeDir,
        });
        // Return cleanup function
        return () => {
            adapter.shutdown();
        };
    },
});
//# sourceMappingURL=v2.js.map