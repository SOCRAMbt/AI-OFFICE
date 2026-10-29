# Política de Seguridad

## Alcance

Esta política cubre el paquete `oficina-opencode` (publicado en npm como `oficina-opencode`) y el repositorio `https://github.com/SOCRAMbt/AI-OFFICE`.

Versiones soportadas: solo la versión más reciente publicada en npm recibe parches de seguridad. Las versiones anteriores no reciben actualizaciones.

## Reportar una vulnerabilidad

Si descubres una vulnerabilidad de seguridad, **no abras un issue público**.

En su lugar, reporta la vulnerabilidad de forma responsable a través de:

1. **GitHub Security Advisories** (preferido): Usa la pestaña "Security" → "Report a vulnerability" en el repositorio. Esto permite una divulgación coordinada privada entre tú y los mantenedores.

### Qué incluir en el reporte

- Descripción clara de la vulnerabilidad y su impacto
- Pasos para reproducir (PoC) si es posible
- Versiones afectadas
- Cualquier mitigación conocida
- Tu información de contacto para coordinar la divulgación

## Respuesta del mantenedor

Este es un proyecto de código abierto mantenido en tiempo libre. No hay SLA formales ni compromisos contractuales de tiempo de respuesta. Los mantenedores responderán según su disponibilidad.

Se recomienda usar **GitHub Security Advisories** para garantizar que el reporte llegue a los mantenedores de forma privada y segura.

## Divulgación coordinada

1. El mantenedor confirma la vulnerabilidad y acuerda una fecha de divulgación.
2. Se prepara el parche en una rama privada.
3. Se publica el advisory en GitHub Security Advisories con CVE si corresponde.
4. Se lanza la versión corregida en npm.
5. Se divulga públicamente tras la disponibilidad del parche.

## Qué NO hacer

- No publiques exploits, PoCs o detalles técnicos en issues públicos antes de la divulgación coordinada.
- No uses canales no seguros (Discord, Twitter, etc.) para reportar vulnerabilidades.
- No exijas plazos de respuesta que no estén acordados.

## Alcance de la auditoría de dependencias

- `npm audit --omit=dev` (dependencias de producción): debe reportar 0 vulnerabilidades en cada release.
- `npm audit` (incluye dependencias de desarrollo): se monitorea y corrige cuando hay versiones compatibles disponibles. Las vulnerabilidades en dependencias de desarrollo que no afectan el paquete publicado (ej. herramientas de test) se documentan como riesgo residual conocido.

## Configuración de seguridad del repositorio

- **Dependabot**: Habilitado para alertas y actualizaciones automáticas de dependencias.
- **CodeQL**: Análisis estático en cada push/PR.
- **Secret scanning**: Habilitado (GitHub secret scanning).
- **Branch protection**: `main` requiere CI verde y revisión antes de merge.

## Contacto

Para consultas sobre esta política: abre una discusión en la pestaña "Security" del repositorio o usa "Report a vulnerability" en la misma pestaña.