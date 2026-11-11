# Hardening del repo y de npm — cierre a maldades

Checklist operativa para que **nadie que no sea el mantenedor** pueda pushear,
publicar o borrar nada. Divide las medidas en lo que ya vive en el repo
(aplicado en archivos) y lo que se activa una vez en la web de GitHub y de npm.

---

## Parte A — Ya aplicado en el repo

| Medida | Archivo | Qué cierra |
|---|---|---|
| Revisión del owner obligatoria en todo el árbol | `.github/CODEOWNERS` | PRs que tocan código sin el visto bueno del owner |
| Superficie CI/seguridad/empaquetado con protección explícita | `.github/CODEOWNERS` | Manipulación de workflows, policy de seguridad o manifest |
| Dependabot semanal (npm + Actions) | `.github/dependabot.yml` | Dependencias y actions que quedan viejas; majors manuales a propósito |
| Publicación OIDC con provenance, environment protegido, sin token de larga vida | `.github/workflows/publish.yml` | Spoofing de publicación, robo de token, publicar algo que no pasó el suite |
| Corredor de verificación previa en el publish | `prepublishOnly` + workflow | Publicar typecheck/test/docs en rojo |
| Política de seguridad sin datos de contacto inventados | `SECURITY.md` | Reportes por canales no verificados |

---

## Parte B — Activar una vez en GitHub (UI del repositorio)

Settings → Saltar al punto → clícalo y listo:

1. **Branch protection de `main`** (Settings → Branches → Add branch ruleset):
   - ✅ *Require a pull request before merging* (1 revisión mínima).
   - ✅ *Require review from Code Owners* — activa la CODEOWNERS de arriba.
   - ✅ *Require status checks to pass before merging* con estos jobs:
     `verify (ubuntu-latest, 24) · verify (ubuntu-latest, 22) · verify (windows-latest, 24) · verify (windows-latest, 22) · docs · smoke · install-verify`.
   - ✅ *Require branches to be up to date before merging*.
   - ✅ *Do not allow bypassing the above settings* (ni apps ni admins).
   - ❌ **Nunca**: *Allow force pushes* · *Allow deletions*.

2. **Ruleset de tags** (Settings → Rules → Rulesets → New → Tag ruleset):
   - Protege `v*`: solo el owner crea tags. Evita que un tag spurio dispare
     publicidad falsa de versiones.

3. **Permisos de Actions** (Settings → Actions → General):
   - ⛔ *Read and write permissions* → cambiar a **Read repository contents** por defecto.
   - ✅ Requiere aprobación de colaboradores para workflows de PRs de primera vez.
   - ✅ Alta del *GitHub Actions* no admite escalación: el token ahora no puede
     pushear ni publicar aunque un agente se piratee.

4. **Secretos** (Settings → Secrets and variables):
   - No necesitas `NPM_TOKEN` si configuras *Trusted Publishing* (punto C.3).
   - Si igual la almacenas: granular (`oficina-opencode` únicamente), con 2FA
     obligatoria y vencido corto mejor que eterno.

5. **Dependabot alerts + security notifications** (Settings → Security):
   - ✅ Dependabot alerts · Code scanning (si se suma CodeQL luego) · Secret scanning.

---

## Parte C — Activar una vez en npm (npmjs.com)

1. **2FA en la cuenta** (Account settings → Security): siempre, obligatoria.
2. **Package settings de `oficina-opencode`**:
   - ✅ *Require two-factor authentication to publish or change settings* (ON — es el default ahora).
   - Mantenedores: **solo el owner**. Cualquier colaboración va por PR, no por copropiedad del paquete.
3. **Trusted Publishing** (Package settings → Publishing access):
   - Vincula el repo `SOCRAMbt/AI-OFFICE` con el workflow `.github/workflows/publish.yml`.
   - Con esto la publicación usa OIDC: **no existe token que filtrar** y npm
     firma la provenance (SLSA 3) del artefacto.
4. **Publicar siempre con provenance**:
   ```bash
   npm publish --provenance
   ```
   El workflow ya lo hace. Instaladores verosificables con
   `npm view oficina-opencode dist.attestations`.

---

## Verificación rápida del cierre

```bash
# ¿Quién puede tocar main? → nadie sin PR del owner (Parte B.1)
# ¿Quién puede publicar? → solo el workflow OIDC del repo (Parte C.3)
# ¿Un PR de un extraño tocará CODEOWNERS? → GitHub lo exige en aprobación automática
```

Si algo de la Parte B/C no está activado, el cierre técnico queda a medias:
los archivos del repo son la mitad grosera; los toggles de la web son la otra.

---

## Auditoria de secretos e historia (v3.1.5 - 2026-11-11)

Escaneo completo ejecutado sobre: historial de git (77 commits, todos los blobs),
arbol actual, y los 4 tarballs publicados en npm (3.0.4, 3.1.2, 3.1.3, 3.1.4).

Resultado:

- **Sin secretos reales en ninguna fuente.** Ni token npm, ni tokens de GitHub,
  claves privadas, tokens de Slack/OpenAI/Google, ni credenciales de servicios.
- **Historial de git**: unicamente el email del autor (casselsmarcos1@gmail.com,
  campo author de package.json entre v3.0.x; ya removido de HEAD). Se conserva en
  la historia a proposito: es el email publico de la cuenta npm, reescribir 2 de
  77 commits romperia clones por cero beneficio.
- **Tarballs**: AKIAIOSFODNN7EXAMPLE (fixture canonico de AWS para tests) en
  snapshots de demo del dashboard - falso positivo verificado. .bak stale se
  colo en 3.1.2/3.1.3 (sin secretos, codigo viejo).
- **Vulnerabilidad real corregida**: dashboard/server.mjs binea a todas las
  interfaces (0.0.0.0) y expone datos de la corrida a la red local. Desde
  v3.1.5 binea a 127.0.0.1. Ademas, los prefix-checks de traversal llevan
  separador explicito.
- **Guard durable**: 	ests/packaging.test.ts corre 
pm pack --dry-run en la
  suite y aborta el publish si el tarball contiene .bak, .env, .npmrc,
  .oficina/, .git/, claves, reportes de auditoria o logs, o si excede 3 MB.
