# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 3.4.x   | :white_check_mark: |
| < 3.3   | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities to the maintainers via GitHub Security Advisories.

## Known Vulnerabilities and Mitigations

### CRIT-01: Zod CVE (GHSA-mrhx-c7xc-m3w5)

**Fixed in v3.4.2+** by upgrading zod to >= 4.6.6.

### CRIT-02: Transitive Dependencies

**Fixed in v3.4.2+** via npm overrides for:
- glob >= 10.0.0
- minimatch >= 9.0.0
- rimraf >= 5.0.0
- cacache >= 18.0.0
- make-fetch-happen >= 11.0.0
- pacote >= 17.0.0
- sigstore >= 2.0.0
- tuf-js >= 2.0.0

### CRIT-03: canonicalizePhysical ENOENT Ambiguity

**Fixed in v3.4.2+** with pre-check for broken symlinks.

## DevDependencies Exceptions (Riesgo Residual Conocido)

Las siguientes vulnerabilidades en `devDependencies` son **riesgo residual conocido** y están documentadas aquí:

- **playwright**: Solo se ejecuta en CI para tests E2E, no en producción
- **@types/node**: Solo tipos, no código ejecutable
- **typescript**: Solo compilación, no runtime
- **vitest**: Solo testing, no producción
- **tsx**: Solo desarrollo/scripts
- **eslint**: Solo linting, no runtime

Estas dependencias no se incluyen en el paquete publicado (`files` en package.json excluye `node_modules` y `devDependencies`).

## Dependencias de desarrollo (riesgo residual conocido)

Las siguientes vulnerabilidades en `devDependencies` son **riesgo residual conocido** y están documentadas aquí:

- **playwright**: Solo se ejecuta en CI para tests E2E, no en producción
- **@types/node**: Solo tipos, no código ejecutable
- **typescript**: Solo compilación, no runtime
- **vitest**: Solo testing, no producción
- **tsx**: Solo desarrollo/scripts
- **eslint**: Solo linting, no runtime

Estas dependencias no se incluyen en el paquete publicado (`files` en package.json excluye `node_modules` y `devDependencies`).

## Scope Enforcement

El hook de scope (`scopeGuard.ts`) previene escrituras fuera del directorio del proyecto y en archivos sensibles (.env, .git/, claves privadas).

## Tripwire Detection

El tripwire (`tripwire.ts`) detecta escrituras no autorizadas después de comandos de shell que no pueden ser prevenidos estáticamente.

---

*Última actualización: 2026-11-22*