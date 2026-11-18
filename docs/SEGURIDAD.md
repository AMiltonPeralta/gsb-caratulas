# Seguridad, privacidad y operación

Este documento explica **qué protege la app, cómo lo hace, qué no protege y cómo verificarlo**. Está escrito para que Milton pueda operarlo y para que Yohita pueda responder con honestidad si un director o un candidato pregunta.

> Regla de oro: ningún sistema es 100 % invulnerable. La promesa real es otra: **reducir la superficie de ataque, cifrar el tránsito, exigir doble factor y dejar evidencia criptográfica de cada cambio**. Si algo se manipula, se detecta.

---

## 1. Qué protegemos

| Activo | Por qué importa | Cómo se protege |
|---|---|---|
| Datos del candidato (CV, resumen, remuneración) | Datos personales (Ley 25.326) | Acceso solo con sesión de administración o link con token; sin caché; sin indexación |
| Foto del ingreso | Imagen personal del candidato | Sólo con sesión o token; tipo fijo (`image/jpeg`/`image/png`); se borra con el expediente |
| Firma del director | Es la manifestación de voluntad | Firma dibujada + declaración + sello SHA-256 + auditoría con fecha, IP y dispositivo |
| PDF firmado | Es la evidencia que se entrega | Hash SHA-256 del archivo guardado en la base y expuesto en `X-Document-SHA256` |
| Registro de auditoría | Prueba quién hizo qué y cuándo | Cadena de hashes: cada evento incluye el hash del anterior |
| Panel de administración | Da acceso a todo | Clave con hash scrypt + TOTP opcional + sesiones revocables + CSRF + rate limit |

**De quién nos defendemos:** de alguien que encuentre un link, de un atacante oportunista en internet, de un dispositivo perdido con la sesión abierta, y de la edición silenciosa de la base o de los archivos.

**De quién no nos defendemos del todo:** de un administrador del servidor con acceso root, de un proveedor cloud comprometido, ni de un ataque dirigido y sostenido. Para eso hace falta infraestructura dedicada, monitoreo 24/7 y un equipo de respuesta.

---

## 2. Controles implementados

### 2.1 Tránsito y cabeceras

| Control | Dónde | Qué hace |
|---|---|---|
| HTTPS obligatorio | `src/security.js` → `enforceHttps` | Redirige `GET`/`HEAD` a HTTPS con 308 y bloquea `POST` sin cifrar con 403 |
| HSTS | `src/security.js` → `securityHeaders` | `Strict-Transport-Security: max-age=31536000; includeSubDomains` cuando la conexión es segura |
| CSP con nonce | `src/security.js` | `script-src 'self' 'nonce-…'`; sin `unsafe-inline` para scripts. El `<script>` de la vista de firma usa el nonce |
| Cabeceras defensivas | `src/security.js` | `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP/CORP, `X-Robots-Tag: noindex` |
| Dominio permitido | `src/security.js` → `checkHost` | Si `ALLOWED_HOSTS` está definido, rechaza cualquier otro `Host` con 400 |
| Sin caché | `src/security.js`, `src/routes/sign.js` | `Cache-Control: no-store` en `/admin` y `/f/…` |
| Archivos controlados | `src/security.js` → `fileHeaders` | PDFs e imágenes (CV, foto del ingreso, firma) se sirven con tipo fijo, `nosniff` y sin la CSP de página |

### 2.2 Acceso al panel

| Control | Dónde | Qué hace |
|---|---|---|
| Clave con hash scrypt | `src/passwords.js` | `ADMIN_PASSWORD_HASH` con `N=16384, r=8, p=1`; la clave no queda en texto plano |
| Comparación en tiempo constante | `src/passwords.js` | `timingSafeEqual` evita filtrar información por tiempos |
| Doble factor TOTP | `src/passwords.js` | RFC 6238, 6 dígitos, ventana ±30 s; se activa con `ADMIN_TOTP_SECRET` |
| Sesiones en base | `src/auth.js` + `migrations/003_security.sql` | Token aleatorio de 32 bytes, guardado **hasheado**; vencimiento absoluto e inactividad |
| Revocación | `src/auth.js` | Logout, vencimiento, inactividad y botón “Cerrar otras sesiones” |
| Rate limit de login | `src/auth.js` | 10 fallos por IP cada 15 minutos |
| CSRF | `src/auth.js` → `requireCsrf` | Token por sesión en todos los `POST` autenticados |
| Control de origen | `src/auth.js` → `sameOrigin` | Rechaza `Sec-Fetch-Site: cross-site` y orígenes que no coinciden |

### 2.3 Links de firma

| Control | Dónde | Qué hace |
|---|---|---|
| Token de 256 bits | `src/repo.js` / `src/util.js` | Aleatorio, sin relación con el candidato |
| Vencimiento | `src/routes/sign.js` | `TOKEN_TTL_HOURS` (168 h por defecto), renovable desde el panel |
| Anulación | `src/routes/sign.js` | Un link anulado responde 410 y no da acceso al expediente |
| Firma inmutable | `src/routes/admin.js` | Una solicitud firmada no se puede anular ni renovar (`WHERE status != 'signed'`); su copia sigue descargable |
| Rechazo sólo Directorio | `src/routes/sign.js` + `src/gsb.js` → `isDirectorio()` | Valida `scope = central` y rol normalizado `directorio`; el resto recibe 403. Exige motivo (5–500 caracteres), registra autor/fecha y anula los links no firmados |
| Rate limit de rechazo | `src/routes/sign.js` | 10 intentos por IP cada 10 minutos |
| Rate limit de firma | `src/routes/sign.js` | 30 intentos por IP cada 10 minutos |
| Control de origen | `src/routes/sign.js` | Un `POST` cross-site se rechaza con 403 |
| Sin login para directores | — | El link es la credencial; se trata como confidencial |

### 2.4 Integridad y evidencia

| Control | Dónde | Qué hace |
|---|---|---|
| `signature_hash` | `migrations/002_signature_hash.sql` | SHA-256 de los datos de la firma (sin el PDF), impreso en la carátula |
| `document_hash` | `src/documents.js` | SHA-256 del PDF firmado, guardado en `signatures` y `documents` |
| Cadena de auditoría | `src/db.js` | Cada fila tiene `prev_hash` y `entry_hash`; `verifyAuditChain()` recalcula todo |
| Rechazo en auditoría | `src/routes/sign.js` | El evento `candidate_rejected` guarda autor, motivo y cantidad de links anulados |
| Verificación | `npm run security:check` | SQLite `integrity_check` + cadena + hashes de documentos + existencia de firmas |
| Validación de CV | `src/routes/admin.js` | Rechaza PDFs con `/JavaScript`, `/Launch`, `/EmbeddedFile`, `/RichMedia` o `/XFA` |
| Respaldos con manifiesto | `scripts/backup.js` | `VACUUM INTO` + copia de archivos + `manifest.json` con SHA-256 de cada pieza |

### 2.5 Configuración de producción

`src/config.js` → `assertProductionConfig()` impide arrancar con `NODE_ENV=production` si:

- no hay `ADMIN_PASSWORD_HASH` y la clave es la de demo o tiene menos de 12 caracteres;
- `SESSION_SECRET` es el de ejemplo o tiene menos de 32 caracteres;
- `BASE_URL` no empieza con `https://`;
- `FORCE_HTTPS` no está activo.

`securityWarnings()` agrega avisos no bloqueantes (TOTP desactivado, `ALLOWED_HOSTS` vacío, respaldos ausentes, etc.) y se muestran en el arranque y en `/admin/seguridad`.

---

## 3. Variables de entorno de seguridad

```env
# Clave del panel: usar hash, no texto plano.
ADMIN_PASSWORD_HASH=scrypt$16384$8$1$...
# Doble factor (opcional pero recomendado).
ADMIN_TOTP_SECRET=JBSW3DPEHPK3PXP
# Secreto interno de al menos 32 caracteres aleatorios.
SESSION_SECRET=...

# Sesión del panel.
SESSION_TTL_HOURS=12
SESSION_IDLE_MINUTES=120

# Red.
FORCE_HTTPS=true
TRUST_PROXY=1
ALLOWED_HOSTS=caratulas.tudominio.com
SECURITY_CONTACT=seguridad@tudominio.com

# Links de firma.
TOKEN_TTL_HOURS=168

# Respaldos.
BACKUP_DIR=backups
```

`TRUST_PROXY` indica cuántos proxies de confianza hay delante (Caddy o Nginx = `1`). Si la app se expone directo, usar `0`.

---

## 4. Puesta en marcha segura

### 4.1 Generar el hash de la clave

```bash
npm run security:hash -- "una clave larga y única"
```

Copia la línea `ADMIN_PASSWORD_HASH=…` en `.env` y **borra `ADMIN_PASSWORD`**. Si perdés la clave, generá otro hash: no se puede recuperar.

### 4.2 Activar el doble factor

```bash
npm run security:totp
```

Imprime un secreto base32 y un enlace `otpauth://`. Agregalo en Google Authenticator, Authy o 1Password y guardá el secreto en `ADMIN_TOTP_SECRET`. Guardá una copia del secreto en un lugar seguro: si se pierde, hay que quitarlo del `.env` para volver a entrar.

### 4.3 Verificar la integridad

```bash
npm run security:check
```

Comprueba:

1. `PRAGMA integrity_check` de SQLite;
2. la cadena de auditoría completa;
3. que cada documento tenga su archivo y que el SHA-256 coincida;
4. que existan las imágenes de firma.

Si algo falla, **no sigas operando**: restaurá desde el último respaldo y revisá quién tuvo acceso al servidor.

### 4.4 Respaldar

```bash
npm run backup
```

Crea `backups/<fecha>/` con:

- `app.db` (copia consistente con `VACUUM INTO`);
- `files/` con CVs, firmas y PDFs;
- `manifest.json` con fecha, URL, hashes y estado de la auditoría.

Programalo todos los días con el Programador de tareas de Windows o `cron`, y **copiá el respaldo fuera del servidor, cifrado**.

---

## 5. Checklist antes de publicar

- [ ] `NODE_ENV=production`
- [ ] `BASE_URL=https://tu-dominio` (sin barra final)
- [ ] `FORCE_HTTPS=true`
- [ ] `ALLOWED_HOSTS=tu-dominio` (sin `https://`, sin barra)
- [ ] `ADMIN_PASSWORD_HASH` configurado y `ADMIN_PASSWORD` vacío
- [ ] `ADMIN_TOTP_SECRET` configurado y probado
- [ ] `SESSION_SECRET` aleatorio de 32+ caracteres (por ejemplo `openssl rand -base64 48`)
- [ ] `SECURITY_CONTACT` con un email o URL real
- [ ] HTTPS funcionando con certificado válido
- [ ] `npm run security:check` en OK
- [ ] `npm run backup` programado y **probada la restauración**
- [ ] `data/` y `backups/` fuera del repositorio y con permisos restringidos
- [ ] Probado el flujo completo desde un celular real, en el navegador interno de WhatsApp
- [ ] Definida la política de retención y borrado de CVs con Yohita

---

## 6. Despliegue con HTTPS (VPS + Caddy)

### 6.1 Docker (recomendado para salir rápido)

```bash
cp .env.example .env
# completar el checklist de §5
# agregar: SITE_ADDRESS=caratulas.tudominio.com
docker compose up -d --build
```

El compose levanta la app (usuario `node`, sin root, healthcheck, volumen `caratulas-data` en `/data`) y Caddy con certificado automático. Los respaldos quedan en el volumen: `docker compose exec app npm run backup`.

### 6.2 Proceso directo con systemd

```bash
# Node 22+ instalado
git clone <repo> /srv/caratulas && cd /srv/caratulas
npm ci --omit=dev
cp .env.example .env
# completar .env con el checklist de arriba
npm run migrate
npm run security:check
npm start
```

`/etc/caddy/Caddyfile`:

```
caratulas.tudominio.com {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
```

Caddy obtiene y renueva el certificado solo. La app escucha en `0.0.0.0:3000`; conviene cerrar el puerto con el firewall y dejar público solo 80/443.

Servicio `systemd` (`/etc/systemd/system/caratulas.service`):

```ini
[Unit]
Description=Caratulas con firma electronica
After=network.target

[Service]
Type=simple
User=caratulas
WorkingDirectory=/srv/caratulas
EnvironmentFile=/srv/caratulas/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/srv/caratulas/data /srv/caratulas/backups

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now caratulas
sudo journalctl -u caratulas -f
```

En Windows, para una prueba local, alcanza con `npm start`. Para producción real conviene Linux: los permisos POSIX de `src/db.js` (0600/0700) protegen la base y los archivos.

---

## 7. Operación y respuesta a incidentes

### Si se filtró un link de firma

1. Entrar al panel → candidato → **Anular** ese link.
2. Generar un firmante nuevo o **Renovar vencimiento** si corresponde.
3. Revisar `/admin/auditoria`: quién lo abrió, desde qué IP y cuándo.

### Si se sospecha acceso al panel

1. Cambiar la clave (`npm run security:hash`, actualizar `.env`, reiniciar).
2. Rotar `ADMIN_TOTP_SECRET`.
3. Entrar y usar **Cerrar otras sesiones** en `/admin/seguridad`.
4. Revisar la auditoría y correr `npm run security:check`.

### Si la verificación de integridad falla

1. **No borrar nada.** Copiar la base y los archivos actuales como evidencia.
2. Restaurar el último respaldo sano en un entorno aparte.
3. Comparar hashes del `manifest.json` con los archivos actuales.
4. Determinar si hubo edición manual de la base, restauración parcial o un bug.
5. Documentar el incidente y avisar a Yohita si hay datos personales comprometidos.

### Si se perdió el dispositivo con la sesión abierta

La sesión vence por inactividad (`SESSION_IDLE_MINUTES`) y en forma absoluta (`SESSION_TTL_HOURS`). Igual conviene entrar desde otro equipo y usar **Cerrar otras sesiones**.

---

## 8. Límites y compromisos honestos

- **Firma electrónica, no digital certificada.** Se usa firma electrónica con constancia de auditoría (Ley 25.506, art. 5). No reemplaza un certificado de firmante licenciado ni una firma digital con token.
- **Sin OCR.** Los CV escaneados como imagen se rechazan para no inventar datos.
- **El link es confidencial.** Quien lo tenga puede abrir la carátula. Por eso vence, se anula y no se comparte fuera del directorio.
- **La base no es inmutable.** La cadena de hashes hace *detectable* la manipulación, no imposible. Para inmutabilidad real haría falta un registro externo (WORM, notarización o blockchain).
- **El servidor es el límite.** Si alguien tiene root en el VPS, puede leer todo mientras la app corre. La defensa real contra eso es control de acceso físico/lógico, cifrado de disco y monitoreo.
- **No hay monitoreo 24/7.** Los avisos son visibles en `/admin/seguridad` y en el arranque; no hay alertas automáticas.
- **Retención de datos.** Yohita define cuánto tiempo se conservan CVs, fotos y PDFs. La app **no borra nada automáticamente**: el borrado es una decisión explícita desde *Retención de datos* en el candidato. Exige escribir el nombre completo, elimina CV, foto, links y PDFs, y deja `candidate_deleted` en la auditoría. Un expediente con firmas no se puede borrar.

---

## 9. Archivos de referencia

```
src/security.js            Cabeceras, HTTPS, host, rate limit, archivos, security.txt
src/auth.js                Sesiones en base, CSRF, origen, rate limit de login
src/passwords.js           scrypt y TOTP
src/db.js                  Cadena de auditoría y permisos de archivos
src/config.js              Validación de producción y avisos
src/routes/admin.js        Centro de seguridad, verificación, PDFs
src/routes/sign.js         Firma con origen controlado y rate limit
src/gsb.js                 Definiciones fijas de la carátula GSB
src/pdf.js                 Carátula GSB en PDF y anexado del CV
views/partials/cover.ejs   Carátula GSB que ve el director
migrations/003_security.sql Sesiones y cadena de auditoría
migrations/004_gsb_cover.sql Campos GSB, foto y ámbito de firma
migrations/005_rejection.sql Rechazo del candidato por el Directorio
scripts/hash-password.js   Genera ADMIN_PASSWORD_HASH
scripts/totp-setup.js      Genera secreto TOTP
scripts/backup.js          Respaldo con manifiesto de hashes
scripts/verify-integrity.js Verificación completa
views/public/security.ejs  Página pública de confianza
views/admin/security.ejs   Centro de seguridad del panel
```

---

Hecho para Yohita · Seguridad con evidencia verificable, sin promesas imposibles.
