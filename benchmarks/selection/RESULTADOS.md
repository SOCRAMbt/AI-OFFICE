# Resultados del benchmark de selección

Generado: 2026-10-26T20:58:01.939Z

Catálogo: 258 agentes (rev: 4e3ac3ca) · 21 tareas

| Estrategia | hit@1 | hit@3 | hit@5 | MRR |
|---|---|---|---|---|
| completo | 71% | 86% | 86% | 0.778 |
| keywords | 48% | 81% | 86% | 0.623 |
| solo-nombre | 52% | 76% | 81% | 0.639 |

## Fallos del matcher completo

- **ux** — esperaba design-ux-architect, design-ui-designer; obtuvo level-designer, economy-designer, design-visual-storyteller
- **fpa** — esperaba finance-fpa-analyst, finance-financial-analyst; obtuvo support-finance-tracker, gis-geoprocessing-specialist, gis-geoai-ml-engineer
- **code-review** — esperaba engineering-code-reviewer, engineering-software-architect, engineering-codebase-onboarding-engineer; obtuvo specialized-civil-engineer, design-visual-storyteller, xr-interface-architect

<!-- FINGERPRINT: {"catalogRevision":"4e3ac3ca6604c75113f52c695dbddcc7af928b46","catalogSize":258,"taskCount":21,"tasksHash":"-5870d52","metrics":[{"name":"completo","hit1":"71%","hit3":"86%","hit5":"86%","mrr":"0.778"},{"name":"keywords","hit1":"48%","hit3":"81%","hit5":"86%","mrr":"0.623"},{"name":"solo-nombre","hit1":"52%","hit3":"76%","hit5":"81%","mrr":"0.639"}],"failures":[{"task":"ux","expected":["design-ui-designer","design-ux-architect"],"got":["design-visual-storyteller","economy-designer","level-designer"]},{"task":"fpa","expected":["finance-financial-analyst","finance-fpa-analyst"],"got":["gis-geoai-ml-engineer","gis-geoprocessing-specialist","support-finance-tracker"]},{"task":"code-review","expected":["engineering-code-reviewer","engineering-codebase-onboarding-engineer","engineering-software-architect"],"got":["design-visual-storyteller","specialized-civil-engineer","xr-interface-architect"]}]} -->
