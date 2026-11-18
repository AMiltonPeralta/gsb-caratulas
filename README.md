# Carátula de Ingreso GSB con firma electrónica

MVP para reemplazar el circuito de **imprimir la carátula y firmarla en persona** por un link de WhatsApp que el directorio abre en el celular, revisa el CV y el resumen del candidato, y firma con el dedo.

La carátula es la **Carátula de Ingreso Digital de Grúas San Blas (GSB)**, fija: la misma que usa hoy Selección & Desarrollo, replicada en la vista de firma y en el PDF. No es una plantilla genérica configurable.

Basado en el informe `informe-app-firma-digital-caratulas.md` (secciones 4 a 7).

---

## 1. Qué incluye

**Panel de Yohita** (`/admin`, funciona en celular y computadora)

- Alta de candidato **solo con el CV en PDF**: el agente extrae del CV los datos que puede completar (nombre, edad, función, sector, área, remuneración) y redacta el resumen.
- **Carátula de Ingreso GSB fija**: secciones 1 Datos del postulante, 2 Fuentes de reclutamiento, 3 Condiciones de contratación y 4 Aprobaciones y firmas. En condiciones, **Horas extra** y **Tarjeta corporativa** se muestran como opciones **NO / SI** con la elegida resaltada.
- Datos y resumen **editables** después de la extracción, y botón para volver a analizar el CV.
- **Foto del ingreso** (JPG/PNG) en la sección 1, también en la vista de firma y en el PDF.
- Completitud de la carátula: avisa qué falta y **bloquea los links de firma** hasta tener postulante, sucursal, al menos una fuente y tipo de puesto (nuevo o reemplazo).
- Un link único por director, con vencimiento y posibilidad de anular o renovar.
- Envío por WhatsApp con mensaje prellenado (`wa.me`) o copiando el link.
- Estado por candidato: borrador, enviado, firma parcial, firmado, vencido o **rechazado**.
- **Rechazo del candidato**: sólo el rol **Directorio** puede cerrar el proceso desde su link, con motivo obligatorio. Se anulan los links pendientes, las firmas existentes se conservan como evidencia y el motivo queda en el panel, en la vista y en el PDF.
- Descarga del PDF firmado y de la carátula actual.
- Auditoría: quién abrió, cuándo, desde qué IP y dispositivo, y código de firma SHA-256.
- Centro de seguridad (`/admin/seguridad`): controles activos, verificación de integridad y cierre de sesiones.

**Vista del directorio** (`/f/<token>`, sin login)

- Mobile-first, pensada para el navegador interno de WhatsApp.
- Tres pestañas: **Carátula**, **Resumen** y **CV**.
- Firma dibujada en pantalla (canvas táctil o mouse) + declaración de voluntad.
- Si el link corresponde al rol **Directorio**, además puede **rechazar al candidato** con un motivo; el resto de los roles no ve esa opción.
- Sello de fecha/hora, IP, dispositivo y código de firma en el PDF.
- Pantalla de confirmación y descarga de la copia firmada.

**PDF**

- Carátula GSB A4 con el diseño oficial: header blanco con línea roja `#C8102E`, “GRÚAS SAN BLAS”, las cuatro secciones y la foto del ingreso.
- Bloques de firma fijos por ámbito: **Sucursal** (Líder de Sector, Coordinador) y **Casa Central** (Recursos Humanos, Líder de Sector, Gerente, Directorio).
- Las firmas de roles que no coinciden con esos bloques no se pierden: se listan en **Otras firmas**.
- Al final se anexan el resumen del candidato y las páginas del CV.
- Una carátula compartida por candidato; todos los directores firman el mismo documento (ver §10).

**Seguridad**

- HTTPS obligatorio en producción, HSTS, CSP con nonce y cabeceras defensivas.
- Clave con hash scrypt, doble factor TOTP opcional y sesiones revocables.
- CSRF por sesión, control de origen y límites de intentos.
- Auditoría encadenada: si un evento se edita o se borra, la verificación lo detecta.
- Página pública `/seguridad` y documento técnico [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md).

---

## 2. Requisitos

- **Node.js 22.5 o superior** (probado con Node 26). Usa `node:sqlite`, incluido en Node, así que no hace falta compilar nada nativo.
- No requiere Python, Docker ni base de datos externa.

---

## 3. Puesta en marcha

### Windows (PowerShell)

```powershell
cd firma-caratulas
npm install
Copy-Item .env.example .env
npm run migrate
npm run seed      # opcional: crea un candidato de demo con dos links
npm start
```

### macOS / Linux

```bash
cd firma-caratulas
npm install
cp .env.example .env
npm run migrate
npm run seed
npm start
```

Abrí **http://localhost:3000/admin**.

Clave por defecto: `yohita2026` (cambiala en `.env` antes de publicar).

El seed crea un candidato de demo (Lucía Fernández) con la carátula GSB completa, foto de muestra y dos links de firma: Martín Sosa (Gerente) y Carolina Pérez (Recursos Humanos). Imprime los links en consola; también podés abrirlos desde el detalle del candidato.

> Si `npm` no está en el PATH después de instalar Node, cerrá y volvé a abrir la terminal.

### Mover el proyecto a otra computadora

Si copiás la carpeta completa (incluyendo `data/`), en la otra computadora ejecutá:

```bash
npm install
npm run migrate
npm run relocate
npm start
```

`npm run relocate` repara las rutas absolutas de CVs, fotos, firmas y PDFs que quedaron guardadas con la ruta vieja, y avisa si falta algún archivo.

### Generar PDFs de ejemplo (sin levantar el servidor)

```bash
npm run example
```

Crea en `/ejemplos`:

- `caratula-ejemplo.pdf` — carátula GSB sin firmas.
- `caratula-ejemplo-firmada.pdf` — con dos firmas de muestra (Gerente y Recursos Humanos).
- `cv-ejemplo.pdf`, `firma-ejemplo.png` y `foto-ejemplo.png`.

---

## 4. Flujo de uso

1. **Nuevo candidato**: Yohita sube únicamente el CV en PDF. El agente lee el archivo y completa lo que puede: nombre, edad, función, sector, área, remuneración y LinkedIn, y redacta el resumen. Los datos GSB que no están en el CV quedan vacíos.
2. **Completar la carátula GSB** desde *Carátula GSB* en el expediente: sucursal, fuentes de reclutamiento, tipo de puesto (nuevo o reemplazo), condiciones de contratación, foto del ingreso y datos de los responsables. El formulario replica las secciones 1 a 3 del documento original.
3. Revisar y corregir el resumen o los datos extraídos (o usar **Volver a analizar el CV**).
4. **Agregar firmante**: nombre, rol GSB (ámbito + rol), WhatsApp y email. Se genera un link único por director.
5. **Enviar por WhatsApp**: abre WhatsApp con el mensaje y el link. También se puede copiar el link y mandarlo a mano.
6. El director abre el link, revisa carátula, resumen y CV, y firma.
7. En el panel aparece la firma, la fecha y el código de verificación. Cuando firman todos, se descarga el **PDF firmado**.

### Validaciones antes de generar links

La carátula original exige cuatro datos. Si falta alguno, el panel **no genera links de firma** y muestra qué completar:

- postulante (apellido, nombre);
- sucursal / localidad;
- al menos una fuente de reclutamiento;
- tipo de puesto: **nuevo** o **reemplazo**.

El resto de los campos (edad, función, sector, área, seleccionado por, líder directo, sueldos) se muestran como recomendados: la carátula se puede firmar igual, pero el PDF queda incompleto.

### Reglas de los links

| Estado | Se puede renovar | Se puede anular |
|---|---|---|
| Pendiente / abierto | Sí | Sí |
| Vencido / anulado | Sí (reactiva) | — |
| Firmado | No | **No**: la firma es evidencia y su copia sigue disponible |
| Candidato rechazado | No | **No**: el proceso quedó cerrado |

Un link anulado responde `410` y ya no da acceso al expediente. El PDF firmado, en cambio, se conserva y se puede descargar siempre. Para sumar un firmante después de una firma, se agrega uno nuevo sobre la misma carátula: no se reemplaza ni se borra la firma anterior.

**Rechazo:** sólo el rol **Directorio** de Casa Central puede rechazar. El motivo es obligatorio (mínimo 5 caracteres) y queda registrado con nombre, fecha y hora. Se anulan los links pendientes; las firmas ya emitidas se conservan. El link anulado de un candidato rechazado sigue mostrando la carátula y el motivo, pero ya no permite firmar. Sobre un candidato rechazado no se pueden agregar firmantes, renovar links, editar la carátula ni volver a analizar el CV.

La carátula y la foto **no se pueden editar si ya hay firmas registradas**: se bloquea para no cambiar un documento ya firmado. Si hace falta corregir, se crea un candidato nuevo.

---

## 5. Configuración (`.env`)

| Variable | Para qué | Default |
|---|---|---|
| `BASE_URL` | URL pública usada para armar los links. **Imprescindible en producción.** | `http://localhost:3000` |
| `PORT` | Puerto del servidor. | `3000` |
| `ADMIN_PASSWORD` | Clave del panel. En producción usar `ADMIN_PASSWORD_HASH`. | `yohita2026` |
| `ADMIN_PASSWORD_HASH` | Hash scrypt de la clave (`npm run security:hash`). | — |
| `ADMIN_TOTP_SECRET` | Secreto del doble factor (`npm run security:totp`). Si está vacío, no pide código. | — |
| `SESSION_SECRET` | Secreto interno (32+ caracteres aleatorios). | valor de ejemplo |
| `ADMIN_NAME` | Nombre que aparece en el panel. | `Yohita` |
| `TOKEN_TTL_HOURS` | Validez de cada link de firma. | `168` (7 días) |
| `SESSION_TTL_HOURS` | Duración absoluta de una sesión del panel. | `12` |
| `SESSION_IDLE_MINUTES` | Corte por inactividad. | `120` |
| `FORCE_HTTPS` | Redirige todo a HTTPS y activa HSTS. Obligatorio en producción. | `false` |
| `TRUST_PROXY` | Proxies de confianza delante de la app (Caddy/Nginx = `1`). | `1` |
| `ALLOWED_HOSTS` | Dominios aceptados, separados por coma. | vacío |
| `SECURITY_CONTACT` | Contacto para `/.well-known/security.txt`. | vacío |
| `TZ` | Zona horaria de los sellos. | `America/Argentina/Buenos_Aires` |
| `DB_PATH` | Archivo SQLite. | `data/app.db` |
| `UPLOAD_DIR` | Carpeta de CVs, firmas y PDFs. | `data/uploads` |
| `BACKUP_DIR` | Carpeta de respaldos. | `backups` |
| `AI_PROVIDER` | `mock`, `gemini` u `openrouter`. | `mock` |
| `AI_MODEL` | Modelo a usar. | según proveedor |
| `GEMINI_API_KEY` | Clave de Google AI Studio. | — |
| `OPENROUTER_API_KEY` | Clave de OpenRouter. | — |
| `AI_PROMPT_FILE` | Archivo del prompt del resumen. | `prompts/resumen-candidato.md` |
| `AI_EXTRACTION_PROMPT_FILE` | Archivo del prompt que extrae los datos del CV. | `prompts/extraer-datos.md` |
| `COMPANY_NAME` | Nombre de la empresa si la carátula no lo define. | `GRÚAS SAN BLAS` |
| `COVER_TEMPLATE_FILE` | Archivo con marca y textos legales del PDF (no cambia las secciones fijas GSB). | `templates/caratula.json` |

### Extracción de datos y resumen con IA

Yohita solo sube el CV. El agente hace dos pasos:

1. **Extrae los datos** con `prompts/extraer-datos.md`: nombre, edad, función, sector, área, remuneración pretendida, disponibilidad y LinkedIn. Los campos GSB que no aparecen en el CV (sucursal, fuentes, tipo de puesto, convenio, horario, etc.) quedan para completar en el panel.
2. **Redacta el resumen** con `prompts/resumen-candidato.md` a partir de los datos extraídos y del texto del CV.

- **`mock`** (default): no llama a ninguna API. Usa heurísticas locales para leer el CV (nombre, rol, área, años de experiencia, LinkedIn, montos y disponibilidad) y arma un resumen con las secciones de perfil, experiencia, formación y puntos fuertes. Sirve para probar todo el circuito sin gastar tokens.
- **`gemini`**: configurá `GEMINI_API_KEY` y `AI_PROVIDER=gemini`.
- **`openrouter`**: configurá `OPENROUTER_API_KEY` y `AI_PROVIDER=openrouter`.

Los dos prompts viven en `prompts/` y se pueden editar sin tocar código. Si el proveedor de IA falla, el alta no se bloquea: se completa con la lectura heurística, se genera un borrador de resumen y el panel muestra qué revisar. Todo queda editable.

El CV tiene que ser un **PDF con texto seleccionable**. Los PDF escaneados como imagen y las fotos (PNG/JPG) se rechazan con un mensaje claro porque todavía no hay OCR.

Desde el detalle del candidato se puede usar **Volver a analizar el CV** para repetir la extracción. Se bloquea si ya hay firmas registradas, para no cambiar un documento ya firmado.

---

## 6. Carátula de Ingreso GSB (fija)

La carátula **no es configurable por cliente**: es el formulario oficial de Grúas San Blas y se usa tal cual. El mismo documento se replica en cuatro lugares, que tienen que mantenerse sincronizados:

| Archivo | Rol |
|---|---|
| `src/gsb.js` | Constantes: sucursales, fuentes, roles, ámbitos y validaciones de completitud |
| `views/partials/cover.ejs` | Carátula read-only que ve el director en la vista de firma |
| `views/admin/cover-form.ejs` | Formulario del panel para completar las secciones 1 a 3 y la foto |
| `src/pdf.js` | Generación del PDF A4 con el mismo diseño |

### Secciones

1. **Datos del postulante** — postulante (apellido, nombre), edad, sucursal/localidad, seleccionado por, prueba técnica, fit cultural, función, sector, área, responsable nacional, responsable de sector/sucursal, líder o tutor directo y **foto del ingreso**.
2. **Fuentes de reclutamiento** — Base de Datos, Página Web, Portal de Empleo, Pres. Espontánea, Referido, Consultora, Formulario QR, Sucursal, Pasantía y Cesión. Además, tipo de puesto (**nuevo** o **reemplazo**) y, si es reemplazo, a quién reemplaza.
3. **Condiciones de contratación** — categoría de convenio, categoría Grúas San Blas, horario, CCT, horas extra, tarjeta corporativa, sueldo bruto, sueldo neto, valor agregado (%) y observaciones.
4. **Aprobaciones y firmas** — dos ámbitos:
   - **Sucursal**: Líder de Sector y Coordinador.
   - **Casa Central**: Recursos Humanos, Líder de Sector, Gerente y Directorio.

Cada bloque de firma muestra el trazo, la aclaración, la fecha y hora, la IP/dispositivo y el código SHA-256 de la firma. Las firmas de roles que no coinciden con esos bloques se listan en **Otras firmas**, tanto en la vista como en el PDF.

### Sucursales

Añelo, Buenos Aires, Casa Central, Centenario, Chaco, Chaco Resistencia, Comodoro Rivadavia, Córdoba, Entre Ríos, Jujuy, Maquinar, Mendoza, Misiones, Rosario y San Juan.

### Foto del ingreso

Se sube desde *Carátula GSB*. Acepta **JPG o PNG de hasta 5 MB**, valida el contenido real del archivo (no sólo la extensión) y se sirve únicamente con sesión del panel o token de firma válido. No se puede cambiar si el expediente ya tiene firmas.

### `templates/caratula.json`

Queda sólo para marca y textos legales del PDF (`company`, `summaryTitle`, `signatureTitle`, `legalText`, `footerNote`). **No** define campos, colores ni secciones: el rojo `#C8102E` y la estructura GSB están fijos en el código. Si Yohita cambia el diseño oficial, hay que actualizar los cuatro archivos de la tabla de arriba.

---

## 7. WhatsApp

El MVP usa **links `wa.me`**: el sistema arma el mensaje y lo abre en WhatsApp con el número del director. No requiere aprobación de Meta, no cuesta y funciona hoy.

Si más adelante quieren envío 100% automático, hay que configurar **WhatsApp Cloud API** (número verificado, plantilla aprobada y costo por conversación). El `.env` ya reserva las variables (`WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`), pero el envío automático es fase 2.

---

## 8. Seguridad, privacidad y validez

La explicación completa —modelo de amenaza, controles, checklist de producción, despliegue HTTPS, respuesta a incidentes y límites— está en **[`docs/SEGURIDAD.md`](docs/SEGURIDAD.md)**. Resumen:

- **Links con token aleatorio** de 256 bits, vencimiento configurable y posibilidad de anular/renovar.
- **Sin login para el directorio**: el link es la credencial. Por eso conviene tratarlo como confidencial.
- **HTTPS obligatorio en producción**: viajan CVs y datos personales. En local, la página `/seguridad` dice “Entorno local de prueba” para no prometer cifrado falso.
- **Acceso a archivos** solo con token válido o sesión de administración; PDFs e imágenes con tipo controlado, sin caché y sin indexación.
- **Clave con hash scrypt** y **doble factor TOTP opcional**. Las sesiones viven en SQLite, vencen por inactividad y se pueden revocar.
- **CSRF** en todos los `POST` del panel, control de origen y límites de intentos en login y firma.
- **Auditoría encadenada**: cada evento incluye el hash del anterior. Si se edita o borra una fila, la verificación deja de cerrar.
- **Código de firma SHA-256** calculado sobre los datos de cada firma (solicitud, candidato, firmante, fecha, IP, dispositivo y trazo). Es el código que se imprime en la carátula y permite verificar una firma sin la referencia circular del hash del PDF.
- **Hash SHA-256 del PDF firmado** (`document_hash`), guardado en la base, en el registro de firma y expuesto en `X-Document-SHA256`.
- **Validación de CVs**: se rechazan PDFs con JavaScript, formularios, archivos embebidos o contenido activo.

### Comandos de seguridad

```bash
npm run security:hash -- "clave larga y única"   # genera ADMIN_PASSWORD_HASH
npm run security:totp                           # genera ADMIN_TOTP_SECRET
npm run security:check                          # verifica base, documentos y auditoría
npm run backup                                  # respaldo con manifiesto de hashes
```

### Firma electrónica vs. firma digital

El sistema implementa **firma electrónica** (Ley 25.506, art. 5): firma dibujada + identificación + constancia de auditoría. Es lo que se puede entregar en una semana.

**No** implementa firma digital con certificado de certificador licenciado (token criptográfico, ej. AFIP/ONTI). Eso requiere integración con un prestador, costo por firma y más tiempo. Si la cliente necesita validez legal reforzada frente a terceros, es fase 2.

### Datos personales

Los CVs son datos personales (Ley 25.326). Antes de publicar, definir con Yohita:

- quién accede al panel (idealmente una sola persona),
- cuánto tiempo se conservan los CVs, las fotos y los PDFs,
- cómo se eliminan cuando termina el proceso,
- y hacer backup de `data/` con acceso restringido y cifrado.

La app incluye **borrado explícito** en el detalle del candidato → *Retención de datos*. Exige escribir el nombre completo, elimina CV, foto, links, PDFs y registros, y deja el evento `candidate_deleted` en la auditoría (que no se borra). Un expediente **con firmas no se puede eliminar**: la firma es evidencia.

Ningún sistema es 100 % invulnerable. Lo que sí garantiza esta app es que **cada manipulación deja rastro y se puede detectar**.

---

## 9. Estructura del proyecto

```
firma-caratulas/
├── deploy/               Caddyfile para Docker
├── docs/                 Documentación (SEGURIDAD.md)
├── Dockerfile            Imagen de producción (Node 24, usuario no root)
├── docker-compose.yml    App + Caddy con HTTPS automático
├── migrations/           Esquema SQL versionado
├── prompts/              Prompts editables: extracción de datos y resumen
├── templates/            Marca y textos legales del PDF (la carátula GSB es fija)
├── public/               CSS, JS y signature_pad (vendorizado)
├── views/                EJS: panel, vista de firma, seguridad, carátula GSB y PDF
├── src/
│   ├── server.js         Express, middlewares de seguridad, arranque
│   ├── config.js         Lectura de .env, avisos y validación de producción
│   ├── db.js             SQLite, cadena de auditoría y permisos
│   ├── auth.js           Sesiones en base, CSRF, origen, rate limit
│   ├── passwords.js      scrypt y TOTP
│   ├── security.js       CSP, HTTPS, hosts, rate limit, archivos
│   ├── ai.js             Resumen con IA (mock/Gemini/OpenRouter)
│   ├── gsb.js            Definiciones fijas de la carátula GSB y validaciones
│   ├── pdf.js            Generación de la carátula GSB y anexado del CV
│   ├── documents.js      Guardado de PDFs/firmas y hashes
│   ├── repo.js           Consultas
│   └── routes/           admin.js y sign.js
├── scripts/              Seed, ejemplos, respaldo, hash, TOTP y verificación
├── backups/              Respaldos (no se versiona)
└── data/                 Base SQLite y archivos (no se versiona)
```

### Base de datos

`candidates`, `signers`, `signature_requests`, `signatures`, `documents`, `audit_log`, `admin_sessions`. El esquema está en `migrations/001_init.sql`, el código de firma en `002_signature_hash.sql`, las sesiones + cadena de auditoría en `003_security.sql`, los campos de la carátula GSB + foto + ámbito de firma en `004_gsb_cover.sql` y el rechazo del candidato en `005_rejection.sql`. Para cambios futuros se agrega otro archivo y se corre `npm run migrate` (idempotente).

### Endpoints principales

```
GET  /admin                              Panel
POST /admin/login                        Ingreso (clave + TOTP opcional)
POST /admin/logout                       Salir (invalida la sesión)
GET  /admin/candidatos/nuevo             Alta
POST /admin/candidatos                   Crear (solo CV: el agente completa los datos)
POST /admin/candidatos/:id/reanalizar-cv Volver a extraer datos y resumen del CV
POST /admin/candidatos/:id/datos         Editar datos generales
GET  /admin/candidatos/:id/caratula      Formulario GSB (secciones 1 a 3 + foto)
POST /admin/candidatos/:id/caratula      Guardar carátula GSB
POST /admin/candidatos/:id/foto          Subir foto del ingreso (JPG/PNG)
POST /admin/candidatos/:id/foto/eliminar Quitar foto
GET  /admin/candidatos/:id/foto          Ver foto (sólo sesión)
POST /admin/api/candidatos/:id/resumen   Generar (body {}) o guardar (body {summary})
POST /admin/candidatos/:id/firmantes     Agregar firmante GSB + link
POST /admin/api/requests/:id/sent        Marcar link compartido
POST /admin/requests/:id/reenviar        Renovar vencimiento
POST /admin/requests/:id/revocar         Anular link (solo si no está firmado)
POST /admin/candidatos/:id/eliminar      Borrar expediente sin firmas (retención)
GET  /admin/candidatos/:id/pdf           Carátula GSB actual
GET  /admin/candidatos/:id/firmado.pdf   PDF firmado
GET  /admin/auditoria                    Auditoría (con estado de la cadena)
GET  /admin/seguridad                    Centro de seguridad
POST /admin/seguridad/verificar          Verificar integridad
POST /admin/seguridad/revocar-sesiones   Cerrar las demás sesiones
GET  /admin/api/auditoria/verificar      Verificación en JSON
GET  /f/:token                           Vista del director
POST /f/:token/firmar                    Registrar firma
GET  /f/:token/cv                        CV (solo con token)
GET  /f/:token/foto                      Foto del ingreso (solo con token)
GET  /f/:token/caratula.pdf              Carátula GSB en PDF
GET  /f/:token/firmado.pdf               Copia firmada
GET  /seguridad                          Página pública de seguridad
GET  /.well-known/security.txt           Contacto de seguridad
GET  /robots.txt                         Bloqueo de indexación
GET  /healthz                            Healthcheck
```

---

## 10. Decisiones por defecto (informe, §9)

El informe dejaba preguntas abiertas. Para no frenar el MVP se tomaron estas decisiones, todas cambiables:

| Pregunta | Decisión |
|---|---|
| ¿Cuántos directores y en qué orden? | Todos firman **la misma carátula**, sin orden obligatorio. Se pueden agregar tantos como haga falta. |
| Campos de la carátula | **Fijos de GSB**: secciones 1 a 4 del formulario oficial. No se configuran por cliente. |
| ¿Quién carga los datos del candidato? | El agente completa **lo que está en el CV**; lo que no está (sucursal, fuentes, tipo de puesto, condiciones) lo completa Yohita en el formulario GSB. |
| Resumen | Lo genera la IA desde el CV y queda editable. Estructura: perfil, experiencia, formación, puntos fuertes. |
| ¿Firma digital o electrónica? | **Electrónica** con auditoría. Si piden certificado, es fase 2. |
| ¿Celular o computadora? | Celular primero; la vista funciona igual en escritorio. |
| ¿Rechazar o comentar? | **Rechazar sólo el rol Directorio**, con motivo obligatorio. No hay comentarios en el MVP. |
| Volumen | Sin límite definido; SQLite alcanza para decenas por semana. |
| Archivo de PDFs | Quedan en `data/uploads` y se descargan desde el panel. Se puede integrar Drive en fase 2. |
| Presupuesto | No informado en el chat. |

---

## 11. Deploy en producción

La app es un solo proceso Node con SQLite y archivos en disco. El paso a paso completo —checklist, Caddy, `systemd`, firewall y respuesta a incidentes— está en **[`docs/SEGURIDAD.md`](docs/SEGURIDAD.md)**.

### Antes de publicar

1. Definir `BASE_URL=https://tu-dominio`, `FORCE_HTTPS=true` y `ALLOWED_HOSTS=tu-dominio`.
2. Generar `ADMIN_PASSWORD_HASH` (`npm run security:hash`) y borrar `ADMIN_PASSWORD`.
3. Configurar `ADMIN_TOTP_SECRET` (`npm run security:totp`) y probar el ingreso.
4. Generar un `SESSION_SECRET` aleatorio de 32+ caracteres.
5. Correr `npm run security:check` y confirmar que da OK.
6. Programar `npm run backup` todos los días y **probar la restauración**.

### Opciones simples

**Render / Railway**

1. Subir el repo a GitHub.
2. Crear un **Web Service** con build `npm ci` y start `npm start`.
3. Variables de entorno del §5, con `NODE_ENV=production` y `BASE_URL=https://tu-dominio`.
4. Montar un **disco persistente** y apuntar ahí `DB_PATH`, `UPLOAD_DIR` y `BACKUP_DIR` (por ejemplo `/var/data/app.db`, `/var/data/uploads`, `/var/data/backups`). Sin disco persistente, los datos se pierden en cada deploy.
5. El proveedor da HTTPS automático.

**VPS con Caddy + systemd**

```bash
git clone <repo> /srv/caratulas && cd /srv/caratulas
npm ci --omit=dev
cp .env.example .env          # completar con el checklist
npm run migrate
npm run security:check
npm start                     # en producción, vía systemd
```

Caddy gestiona el certificado HTTPS y el servicio `systemd` reinicia la app si falla. El `Caddyfile` y la unidad de ejemplo están en `docs/SEGURIDAD.md` §6.

**Docker (app + Caddy con HTTPS automático)**

```bash
cp .env.example .env
# completar §5 y agregar: SITE_ADDRESS=caratulas.tudominio.com
docker compose up -d --build
docker compose logs -f app
```

El `docker-compose.yml` levanta la app con un volumen persistente en `/data` y Caddy en 80/443 con certificado automático. La app corre como usuario `node` (no root), con healthcheck y reinicio automático. Para respaldar: `docker compose exec app npm run backup`. Los archivos están en `Dockerfile`, `docker-compose.yml` y `deploy/Caddyfile`.

> En esta máquina no hay Docker instalado, así que esa variante no se probó localmente. Antes de publicar, validar con `docker compose config` y probar el flujo de firma desde un celular.

### Backup

```bash
npm run backup
```

Crea `backups/<fecha>/` con la base (`VACUUM INTO`), los archivos y un `manifest.json` con el SHA-256 de cada pieza. **Copiar el respaldo fuera del servidor, cifrado.** Probar la restauración antes de confiar en él.

---

## 12. Pruebas sugeridas antes de entregar

1. `npm run seed` y abrir los dos links de demo (Martín Sosa → Gerente y Carolina Pérez → Recursos Humanos).
2. En **Nuevo candidato**, subir `ejemplos/cv-ejemplo.pdf` y verificar que el agente complete nombre, edad, función, sector, área, remuneración y resumen, sin cargar datos a mano.
3. Entrar a **Carátula GSB** y completar sucursal, fuentes, tipo de puesto y condiciones. Subir una foto JPG/PNG y confirmar que aparece en la vista y en el PDF.
4. Intentar agregar un firmante con la carátula incompleta: el panel debe rechazarlo y decir qué falta.
5. Probar **Volver a analizar el CV** y la edición manual de los datos extraídos.
6. En el celular (o DevTools en modo mobile), recorrer las tres pestañas: **Carátula**, **Resumen** y **CV**.
7. Firmar con el dedo, confirmar y verificar que:
   - el link queda firmado y no permite firmar de nuevo,
   - la carátula muestra la firma en el bloque del rol correcto, con fecha y código de verificación,
   - una firma con rol fuera de los bloques aparece en **Otras firmas**,
   - el panel muestra estado “Firma parcial” y luego “Firmado”,
   - el PDF descargado incluye la carátula GSB, el anexo de resumen y el CV.
8. Probar un link vencido (cambiar `expires_at` en la base o esperar) y un link anulado.
9. Probar el rechazo: agregar un firmante con rol **Directorio**, abrir su link y confirmar que ve el botón; verificar que un Gerente no lo ve. Rechazar con motivo, comprobar que los links pendientes quedan anulados, que la vista y el PDF muestran el motivo y que el panel marca “Rechazado”.
10. Probar en el navegador interno de WhatsApp (Android e iPhone) y en computadora.
11. Revisar que `data/` no quede expuesto por ningún endpoint sin token.
12. **Seguridad:**
    - `npm run security:check` debe dar OK.
    - Entrar a `/admin/seguridad` y confirmar que los controles coinciden con el entorno.
    - Enviar un `POST` sin `_csrf` al panel y verificar que responde 403.
    - Abrir `/admin/auditoria` y confirmar que la cadena está íntegra.
    - Probar el login con TOTP activo: código válido entra, código incorrecto no.
    - Descargar `ejemplos/caratula-ejemplo-firmada.pdf` y comparar su hash con el que muestra el panel.

---

## 13. Limitaciones conocidas

- No hay OCR: los CV escaneados como imagen o las fotos del CV se rechazan. Para aceptarlos hay que sumar un servicio de OCR o usar un modelo multimodal.
- El visor de PDF dentro del iframe puede no renderizar en algunos navegadores embebidos (iOS). Siempre está el botón **Abrir** para verlo en pantalla completa.
- No hay edición de la firma una vez registrada. Un link **ya firmado no se anula**: la firma queda como evidencia y su copia sigue descargable. Si falta un firmante, se agrega uno nuevo sobre la misma carátula.
- SQLite soporta un solo proceso escritor; para más volumen conviene migrar a PostgreSQL.
- No hay envío automático por WhatsApp ni recordatorios programados (fase 2).
- La carátula GSB es fija: si cambia el diseño oficial, hay que actualizar `src/gsb.js`, `views/partials/cover.ejs`, `views/admin/cover-form.ejs` y `src/pdf.js`. No se edita desde un JSON.
- La foto del ingreso se guarda como archivo en `UPLOAD_DIR`; si se borra el expediente, se borra junto con el resto.
- Las firmas con roles fuera de los bloques fijos no se descartan: se muestran en **Otras firmas**, pero no ocupan un casillero oficial de la carátula.
- **La firma es electrónica, no digital certificada** (Ley 25.506, art. 5). No reemplaza un certificado de firmante licenciado.
- **La cadena de auditoría es tamper-evident, no inmutable.** Detecta ediciones y borrados; no los impide. Para inmutabilidad real hace falta un registro externo (WORM o notarización).
- **La protección termina en el servidor.** Quien tenga root en el VPS puede leer los datos mientras la app corre. Se mitiga con control de acceso, cifrado de disco y monitoreo.
- **No hay monitoreo 24/7 ni alertas automáticas.** Los avisos se ven en `/admin/seguridad` y en el arranque.
- **La app no borra datos sola.** La retención y el borrado de CVs y fotos son una decisión explícita de Yohita y deben quedar registrados.

---

## 14. Problemas frecuentes

**`npm` no se reconoce** → cerrar y abrir la terminal después de instalar Node.

**El link generado apunta a `localhost`** → falta `BASE_URL` con la URL pública.

**No se ve el CV en el celular** → usar el botón “Abrir” del visor; algunos navegadores de WhatsApp bloquean iframes con PDF.

**Error al generar el resumen con IA** → revisar clave y proveedor en `.env`; el alta se completa igual con una lectura básica y el resumen queda editable.

**“No pudimos leer texto de ese PDF”** → el CV es una imagen escaneada. Subir un PDF con texto seleccionable o convertirlo con OCR antes de cargarlo.

**Se perdió todo después de un deploy** → el disco no es persistente; montar volumen y apuntar `DB_PATH`/`UPLOAD_DIR`.

**La app no arranca con `NODE_ENV=production`** → falta `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` es débil, `BASE_URL` no es HTTPS o `FORCE_HTTPS` está apagado. El mensaje de error indica cuál falta.

**“La solicitud no tiene un token de seguridad válido”** → la página quedó vieja o la sesión venció. Recargá e intentá de nuevo. No desactives el CSRF.

**“Origen no permitido” al firmar** → el navegador envió la firma desde otro sitio. Abrí el link directamente, sin incrustarlo en otra página.

**“Faltan datos obligatorios para enviar a firmas”** → completá postulante, sucursal, al menos una fuente de reclutamiento y tipo de puesto (nuevo o reemplazo) en *Carátula GSB*. Sin esos cuatro datos no se generan links.

**No aparece la foto del ingreso** → tiene que ser JPG o PNG de hasta 5 MB, y se sube desde *Carátula GSB*. Si el expediente ya tiene firmas, la foto queda bloqueada.

**Una firma no aparece en el bloque que esperaba** → el rol y el ámbito del firmante no coinciden con los bloques fijos. Revisá el rol asignado; la firma igual queda registrada en **Otras firmas**.

**La verificación de integridad falla** → no borres nada. Copiá la base y los archivos como evidencia, restaurá el último respaldo sano y revisá el `manifest.json`.

**No sé si la conexión está cifrada** → mirá `/seguridad`. Si dice “Entorno local de prueba”, `BASE_URL` no es HTTPS y no hay que compartir links fuera de la red local.

---

Hecho para Yohita · Firma electrónica con registro de auditoría.
