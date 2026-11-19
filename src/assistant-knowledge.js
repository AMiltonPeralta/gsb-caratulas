/**
 * Base de conocimiento exhaustiva y motor de respuestas del Asistente Virtual GSB
 * Resuelve cualquier consulta operativa, técnica o funcional del panel de Selección y Carátulas.
 */

export const SYSTEM_PROMPT = `
Sos el Asistente Virtual oficial del panel de Selección & Desarrollo de Grúas San Blas (GSB).
Tu función es ayudar a Yohita y al equipo de Selección en el uso diario de la plataforma:
- Creación de candidatos y extracción automática de CVs.
- Confección de la Carátula GSB (sucursales, nómina, condiciones de contratación, foto del ingreso).
- Informe de Entrevista - Modelo de Talento GSB (13 competencias STAR, grados A, B, C, D, PV, y autoguardado continuo).
- Firma electrónica del directorio vía WhatsApp (Ley 25.506, verificación criptográfica hash).
- Descarga de PDF final firmado, rechazos y auditoría encadenada.

Respondé siempre de manera cálida, clara, profesional, en español rioplatense (usando vos/podés) y con instrucciones paso a paso cuando corresponda. Si te consultan algo técnico complejo de servidores o base de datos, recordales que siempre pueden contactar a Milton.
`;

export const FAQ_TOPICS = [
  {
    id: 'nuevo-candidato',
    suggestions: [
        "📝 ¿Cómo funciona el Informe de Entrevista?",
        "📋 ¿Cómo editar la carátula oficial?",
        "🖼️ ¿Cómo subir la foto del ingreso?"
    ],
    triggers: ['cargar candidato', 'nuevo candidato', 'subir cv', 'crear candidato', 'como cargo', 'cv', 'postulante', 'agregar candidato'],
    title: '📄 ¿Cómo cargo un nuevo candidato?',
    reply: `Para cargar un nuevo candidato:
1. En el menú superior hacé clic en **"Nuevo candidato"**.
2. Arrastrá o seleccioná el archivo del **CV en formato PDF**.
3. El sistema analizará automáticamente el documento y completará los datos principales (nombre, puesto sugerido, seniority, sucursal detectada).
4. Al presionar **"Generar expediente"**, se creará la carátula inicial y podrás revisar y completar el resto de la información.

💡 *Tip:* El PDF debe tener texto seleccionable (no ser una foto escaneada sin texto) para que el lector automático pueda interpretar los datos.`
  },
  {
    id: 'informe-entrevista',
    suggestions: [
        "🖨️ ¿Cómo imprimir o guardar en PDF (A4)?",
        "💾 ¿Cómo funciona el autoguardado continuo?",
        "📱 ¿Cómo enviar a firmar por WhatsApp?"
    ],
    triggers: ['informe de entrevista', 'modelo de talento', 'competencias', 'star', 'como lleno el informe', 'grados', 'evaluacion'],
    title: '📝 ¿Cómo funciona el Informe de Entrevista?',
    reply: `El **Informe de Entrevista - Modelo de Talento GSB** evalúa el ajuste del candidato a la cultura y funciones de la empresa:

1. **Datos de entrevista:** Empresa (Grúas San Blas, MaquinAr, ArgenMieles), sucursal, función, sector, fecha, hora, nivel educativo y aspectos personales de contexto.
2. **Ajuste técnico:** Requisitos excluyentes, antecedentes técnicos, resultado de prueba técnica y Fit Cultural.
3. **Competencias GSB:**
   - **Cardinales (C1 a C5):** Orientación al cliente, Dinamismo, Adaptabilidad, Rentabilidad y Criterio.
   - **Específicas del área (E1 a E5):** Se activan según el área elegida (Ventas, Administración, Técnica, etc.).
   - **Liderazgo (L1 a L3):** Se activan si marcás el tilde *"La vacante tiene personal a cargo"*.
4. **Metodología STAR:** Cada competencia cuenta con preguntas sugeridas (Media, Alta o Compleja) para registrar *Situación → Acción → Resultado*.
5. **Calificación:** Se asigna un grado GSB:
   - **A:** Influencia / Modelo a seguir.
   - **B:** Autónomo / Nivel esperado.
   - **C:** En desarrollo / Oportunidad de mejora.
   - **D:** Insuficiente para la vacante.
   - **PV:** Pendiente de validación / Sin evidencia suficiente.
6. **Vista previa ejecutiva:** En el lateral derecho podés ver en tiempo real cómo queda el informe A4 y podés imprimirlo o descargarlo con el botón *"Imprimir / Guardar PDF (A4)"*.`
  },
  {
    id: 'autoguardado',
    suggestions: [
        "📄 ¿Cómo cargo un nuevo candidato?",
        "📱 ¿Cómo enviar a firmar por WhatsApp?",
        "🛡️ ¿Cómo funciona la auditoría?"
    ],
    triggers: ['autoguardado', 'guardar', 'se borra', 'se pierde', 'guardar cambios', 'automatico', 'guardado', 'borrador'],
    title: '💾 ¿Cómo funciona el autoguardado continuo?',
    reply: `¡Nunca vas a perder lo que escribas! El sistema cuenta con dos niveles de protección continua:

1. **Guardado inmediato en tu navegador:** Apenas escribís una sola letra, cambiás un desplegable o tildás una opción, se guarda al instante en tu equipo. Si se te corta la luz o cerrás la pestaña sin querer, al volver a entrar **encontrás todo exactamente como lo dejaste**.
2. **Guardado automático en el servidor:** Cada vez que dejás de tipear (1,2 segundos), el formulario se envía solo a la base de datos sin que tengas que apretar ningún botón.
3. **Aviso visual en pantalla:** Arriba a la derecha del formulario verás el indicador en tiempo real:
   - \`⏳ Guardando automáticamente...\`
   - \`✓ Guardado automáticamente a las (HH:MM:SS)\`

Podés salir, cerrar la ventana o volver al expediente cuando quieras con total tranquilidad.`
  },
  {
    id: 'firmas-whatsapp',
    suggestions: [
        "⏰ ¿Qué hacer si un link de firma venció?",
        "📥 ¿Dónde descargo el PDF firmado?",
        "⚖️ ¿Qué validez legal tiene la firma?"
    ],
    triggers: ['firmar', 'firmantes', 'whatsapp', 'como firman', 'compartir', 'link de firma', 'directorio', 'enviar link', 'celular'],
    title: '📱 ¿Cómo enviar la carátula a firmar por WhatsApp?',
    reply: `Para que los directores o responsables firmen desde su celular:

1. Entrá al expediente del candidato.
2. En la sección **"Firmantes"**, seleccioná quién debe firmar (Directorio Central o Sucursal), ingresá su nombre y su número de WhatsApp.
3. Hacé clic en **"Agregar firmante"**.
4. Se generará un enlace único y seguro para esa persona. Hacé clic en el botón verde **"WhatsApp"** para abrir el chat con el mensaje prearmado listo para enviar.
5. El firmante entra al enlace desde su teléfono, revisa los datos de la carátula, ingresa su DNI y dibuja su firma táctil con el dedo.
6. ¡Listo! Al instante el panel se actualiza a *"Firmado"* y queda registrado con fecha, hora, IP y código de seguridad.`
  },
  {
    id: 'link-vencido',
    suggestions: [
        "📱 ¿Cómo enviar la carátula a firmar por WhatsApp?",
        "📥 ¿Dónde descargo el PDF firmado?",
        "🚫 ¿Cómo rechazar un candidato?"
    ],
    triggers: ['vencio', 'vencido', 'expirado', 'reenviar', 'no le llega', 'validez link', 'cuanto dura el link'],
    title: '⏰ ¿Qué hacer si un link de firma venció o no le llegó al director?',
    reply: `Los links de firma tienen una vigencia por defecto de **72 horas (3 días)** por seguridad.

Si el link venció o el director no lo encuentra:
1. En el expediente del candidato buscá la fila del firmante.
2. Podés hacer clic en **"Copiar link"** para pasárselo directamente por cualquier medio.
3. Si ya expiró, podés eliminar la solicitud vencida con el botón del tacho de basura y volver a agregarlo para generar un link 100% fresco con nuevo vencimiento.
4. Al hacer clic en el botón de **WhatsApp**, se abrirá la conversación con el nuevo enlace listo.`
  },
  {
    id: 'rechazar-candidato',
    suggestions: [
        "🛡️ ¿Cómo funciona la auditoría?",
        "🗑️ ¿Cómo eliminar candidatos?",
        "📄 ¿Cómo cargo un nuevo candidato?"
    ],
    triggers: ['rechazar', 'rechazo', 'motivo rechazo', 'cancelar candidato', 'no ingresa', 'dar de baja'],
    title: '🚫 ¿Cómo rechazar un candidato o registrar una decisión negativa?',
    reply: `Si el Directorio o Selección decide no avanzar con la incorporación:

1. Entrá al expediente del candidato.
2. En la parte inferior vas a encontrar la sección **"Rechazar candidato"**.
3. Seleccioná quién tomó la decisión (ej. Directorio) e ingresá el motivo de forma clara.
4. Presioná **"Confirmar rechazo"**.

**¿Qué pasa cuando se rechaza?**
- El candidato pasa a estado **"Rechazado"** con fondo gris distintivo.
- Todos los links de firma pendientes se anulan automáticamente para que nadie más pueda firmar.
- Las firmas que ya se hayan realizado se conservan como evidencia legal inmutable.
- Queda registrado en la cadena de auditoría con fecha y responsable.`
  },
  {
    id: 'descargar-pdf',
    suggestions: [
        "⚖️ ¿Qué validez legal tiene la firma?",
        "🖨️ ¿Cómo imprimir el Informe de Entrevista (A4)?",
        "🛡️ ¿Cómo funciona la auditoría?"
    ],
    triggers: ['descargar', 'pdf', 'descargar pdf', 'imprimir caratula', 'documento', 'bajar pdf', 'donde esta el pdf'],
    title: '📥 ¿Dónde descargo el PDF firmado o la carátula oficial?',
    reply: `Podés descargar el PDF en cualquier momento desde el expediente del candidato:

- **Carátula preliminar (sin firmas):** Mientras se está gestionando, en la barra lateral hacés clic en **"Descargar carátula (PDF)"** para tener una copia de trabajo.
- **Carátula oficial firmada:** Una vez que los directores firman, en la parte superior del expediente aparece el botón destacado:
  **"Descargar carátula firmada (PDF)"**
  Este documento incluye la carátula con diseño corporativo GSB, todas las firmas incrustadas, la fecha y hora exacta de cada una y el sello criptográfico SHA-256 de verificación.`
  },
  {
    id: 'imprimir-informe',
    suggestions: [
        "📝 ¿Cómo funciona el Informe de Entrevista?",
        "📥 ¿Dónde descargo el PDF firmado?",
        "💾 ¿Cómo funciona el autoguardado?"
    ],
    triggers: ['imprimir informe', 'guardar informe pdf', 'pdf informe', 'exportar informe', 'a4'],
    title: '🖨️ ¿Cómo imprimir o guardar el Informe de Entrevista en PDF (A4)?',
    reply: `Para obtener una copia ejecutiva del informe de competencias:

1. Entrá a **"Informe de entrevista"** del candidato.
2. En la barra superior hacé clic en **"Imprimir / Guardar PDF (A4)"**.
3. En la ventana de impresión de tu navegador:
   - Destino: Elegí **"Guardar como PDF"** (o tu impresora física).
   - Diseño: **Vertical / A4**.
   - En *Más opciones*, asegurate de marcar **"Gráficos de fondo"** para que los colores de GSB se vean perfectos.
4. Presioná **Guardar**. Se generará una hoja ejecutiva limpia con el resumen, competencias y decisión final.`
  },
  {
    id: 'caratula-editar',
    suggestions: [
        "🖼️ ¿Cómo subir o cambiar la foto del ingreso?",
        "💼 ¿Cómo cargar sueldos y convenio (CCT)?",
        "📱 ¿Cómo enviar a firmar por WhatsApp?"
    ],
    triggers: ['caratula', 'modificar caratula', 'editar caratula', 'completar caratula', 'datos ingreso'],
    title: '📋 ¿Cómo editar la carátula oficial de ingreso?',
    reply: `En el expediente del candidato hacé clic en **"Completar carátula oficial GSB"**:

- Podés cargar o ajustar la sucursal, sector, función, convenio colectivo (CCT), categoría salarial, remuneración bruta/neta, horas extras y observaciones.
- Al presionar **"Guardar carátula"**, el documento se actualiza automáticamente.

⚠️ *Importante:* Si algún director ya firmó, los campos de la carátula se congelan automáticamente. Esto es obligatorio para que el documento firmado no pueda ser alterado a espaldas de quien ya firmó.`
  },
  {
    id: 'foto-ingreso',
    suggestions: [
        "📋 ¿Cómo editar la carátula oficial de ingreso?",
        "💼 ¿Cómo cargar sueldos y convenio (CCT)?",
        "📥 ¿Dónde descargo el PDF firmado?"
    ],
    triggers: ['foto', 'foto ingreso', 'subir foto', 'cambiar foto', 'imagen', 'formato foto'],
    title: '🖼️ ¿Cómo subir o cambiar la foto del ingreso?',
    reply: `Para incluir la foto oficial del postulante:

1. En el expediente del candidato entrá a **"Completar carátula oficial GSB"** (o en la tarjeta de foto del expediente).
2. Seleccioná una imagen en formato **JPG o PNG** (hasta 5 MB).
3. Hacé clic en **"Subir foto"**.
4. La foto quedará enmarcada en la carátula oficial y se adjuntará al expediente.

Si necesitás cambiarla o quitarla, vas a ver los botones **"Cambiar foto"** y **"Eliminar foto"** debajo de la imagen actual.`
  },
  {
    id: 'condiciones-cct',
    suggestions: [
        "📋 ¿Cómo editar la carátula oficial de ingreso?",
        "📱 ¿Cómo enviar a firmar por WhatsApp?",
        "📝 ¿Cómo funciona el Informe de Entrevista?"
    ],
    triggers: ['cct', 'convenio', 'sueldo', 'remuneracion', 'horas extras', 'tarjeta corporativa', 'salario', 'bruto', 'neto'],
    title: '💼 ¿Cómo cargar sueldos, convenio (CCT) y condiciones?',
    reply: `Dentro de **"Completar carátula oficial GSB"** podés detallar las condiciones aprobadas para el puesto:

- **Convenio y Categoría:** Podés indicar si entra bajo convenio colectivo (ej. Comercio, Metalúrgicos, etc.) o si está fuera de convenio, junto con su categoría interna GSB.
- **Remuneración:** Se sugiere ingresar el monto bruto acordado y, si corresponde, el neto estimado de bolsillo.
- **Horas extras y tarjeta:** Desplegables para marcar **SÍ / NO** según corresponda a la posición.
- **Valor agregado / Justificación:** Espacio para fundamentar el perfil ante el Directorio.`
  },
  {
    id: 'eliminar-candidatos',
    suggestions: [
        "🔍 ¿Cómo buscar candidatos en el panel?",
        "📄 ¿Cómo cargo un nuevo candidato?",
        "🛡️ ¿Cómo funciona la auditoría?"
    ],
    triggers: ['eliminar candidato', 'borrar candidato', 'vaciar lista', 'quitar candidato', 'borrar todo', 'eliminar todo'],
    title: '🗑️ ¿Cómo eliminar candidatos o vaciar la lista?',
    reply: `Existen dos formas de limpieza según lo que necesites:

1. **Eliminar un candidato individual:**
   - En el listado principal del panel, hacé clic en el botón del tacho de basura **"Eliminar"** en la tarjeta del candidato.
   - También podés hacerlo desde el fondo del expediente del candidato escribiendo su nombre para confirmar.
   - Se borran sus datos, su CV, sus fotos y sus firmas asociadas de forma segura.

2. **Vaciar la lista completa:**
   - En el panel principal, arriba a la derecha de la lista tenés el botón rojo **"Vaciar lista"**.
   - Te pedirá confirmación para evitar borrados accidentales y limpiará los candidatos de prueba acumulados.`
  },
  {
    id: 'buscar-candidatos',
    suggestions: [
        "📄 ¿Cómo cargo un nuevo candidato?",
        "📱 ¿Cómo enviar a firmar por WhatsApp?",
        "📥 ¿Dónde descargo el PDF firmado?"
    ],
    triggers: ['buscar', 'filtrar', 'filtro', 'encontrar candidato', 'buscador', 'buscar candidato'],
    title: '🔍 ¿Cómo buscar candidatos en el panel?',
    reply: `En la pantalla principal del panel tenés una barra de búsqueda en tiempo real:

- Podés escribir parte del **nombre** (ej. "Fernández", "Lucía") o del **puesto** (ej. "Mecánico", "Operaciones").
- La lista filtra automáticamente en vivo sin recargar la página.
- Para volver a ver todos, simplemente borrá el texto del buscador.`
  },
  {
    id: 'seguridad-validez',
    suggestions: [
        "🛡️ ¿Cómo funciona la auditoría?",
        "📱 ¿Cómo enviar a firmar por WhatsApp?",
        "👤 Usuarios y perfiles disponibles"
    ],
    triggers: ['legal', 'ley', 'validez', 'firma digital', 'firma electronica', 'auditoria', 'seguridad', 'hash', 'sha256'],
    title: '⚖️ ¿Qué validez legal tiene la firma electrónica?',
    reply: `La firma de carátulas se rige bajo la **Ley Nacional 25.506 de Firma Electrónica**:

- **No repudio y trazabilidad:** Cada firma registra la dirección IP, fecha y hora exacta, navegador utilizado, DNI del firmante y declaración legal de conformidad.
- **Sello criptográfico (Hash SHA-256):** Cada firma genera un código de verificación inalterable. Si alguien intentara modificar una coma del documento posteriormente, el sello se rompe de forma detectable.
- **Cadena de auditoría:** Todas las acciones del sistema quedan registradas en el historial cronológico encadenado disponible en la pestaña **"Auditoría"**.`
  },
  {
    id: 'auditoria',
    suggestions: [
        "⚖️ ¿Qué validez legal tiene la firma?",
        "🚫 ¿Cómo rechazar un candidato?",
        "👤 Usuarios y perfiles disponibles"
    ],
    triggers: ['auditoria', 'historial', 'eventos', 'verificar cadena', 'quien modifico', 'trazabilidad'],
    title: '🛡️ ¿Cómo funciona la Auditoría y el control de integridad?',
    reply: `En el menú superior tenés la pestaña **"Auditoría"**:

- **Historial completo:** Muestra cada evento registrado (creación de candidato, apertura de link, firma realizada, descarga de PDF, inicio de sesión).
- **Cadena inalterable:** Cada evento está sellado con el código hash del evento anterior. Si alguien intentara alterar la base de datos a mano, la cadena se corta.
- **Botón "Verificar integridad":** Te permite comprobar al instante si todos los eventos y firmas del sistema están 100% sellados e íntegros.`
  },
  {
    id: 'usuarios',
    suggestions: [
        "🛡️ ¿Cómo funciona la auditoría?",
        "🛠️ ¿Necesitás soporte técnico adicional?",
        "💾 ¿Cómo funciona el autoguardado?"
    ],
    triggers: ['usuario', 'contraseña', 'clave', 'sesion', 'login', 'yohita', 'milton', 'admin', 'cerrar sesion', 'salir'],
    title: '👤 Usuarios y perfiles disponibles',
    reply: `El panel cuenta con usuarios identificados para mayor seguridad:

- **\`yohita\`** (contraseña: \`yohita2026\`) → Perfil oficial de Selección & Desarrollo.
- **\`admin\`** (contraseña: \`yohita2026\`) → Administrador general.
- **\`milton\`** (contraseña: \`yohita2026\`) → Soporte técnico.

El sistema recuerda tu usuario para que la próxima vez solo tengas que ingresar la clave. Para salir, podés presionar el botón **"Salir"** en la esquina superior derecha.`
  },
  {
    id: 'contacto-soporte',
    suggestions: [
        "📄 ¿Cómo cargo un nuevo candidato?",
        "📱 ¿Cómo enviar a firmar por WhatsApp?",
        "💾 ¿Cómo funciona el autoguardado?"
    ],
    triggers: ['ayuda', 'error', 'soporte', 'milton', 'problema', 'falla', 'contacto', 'no funciona', 'se traba'],
    title: '🛠️ ¿Necesitás soporte técnico adicional?',
    reply: `Si encontrás algún comportamiento inesperado, tenés una consulta específica sobre la base de datos o querés sugerir una nueva función, avisale directamente a **Milton**:

- Teléfono / WhatsApp personal.
- El sistema cuenta con auditoría y respaldo continuo de todos los datos para que nunca se pierda nada.`
  }
];

/**
 * Normaliza texto eliminando acentos y caracteres especiales para matching robusto.
 */
function cleanQuery(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Responde a una consulta del usuario utilizando coincidencia inteligente por intención y palabras clave.
 */
export function getAssistantResponse(query) {
  const rawQ = String(query || '').trim();
  const q = cleanQuery(rawQ);

  // 0. Reiniciar / Borrar respuestas / Empezar de cero
  if (/^(borrar|limpiar|reiniciar|reset|empezar de cero|volver al inicio|desde cero|borrar respuestas|limpiar chat|nueva consulta|empezar)\b/.test(q)) {
    return {
      reply: '¡Listo! Conversación reiniciada para empezar desde cero. ✨\n\nPodés escribir cualquier consulta o elegir cualquiera de estos temas:',
      suggestions: [
        '¿Cómo cargo un nuevo candidato?',
        '¿Cómo funciona el Informe de Entrevista?',
        '¿Cómo funciona el autoguardado continuo?',
        '¿Cómo enviar a firmar por WhatsApp?'
      ]
    };
  }

  // 0.1 Ver catálogo completo de temas
  if (/^(ver todos|todos los temas|menu|catalogo|temas disponibles|que puedo preguntar|lista de preguntas|ayuda)\b/.test(q)) {
    return {
      reply: `📋 **Catálogo completo de temas de ayuda:**

• **Candidatos y Legajos:**
  - Cómo cargar nuevo candidato y subir CV en PDF.
  - Cómo editar la carátula oficial GSB y la foto de ingreso.
  - Carga de remuneración, convenio (CCT) y horas extras.

• **Informe de Entrevista Modelo GSB:**
  - Guía STAR con las 13 competencias laborales.
  - Preguntas sugeridas, fit cultural y prueba técnica.
  - Impresión y guardado en PDF (A4) en una sola hoja.

• **Firmas Digitales y WhatsApp:**
  - Envío de links directos a Selección y Directorio.
  - Vencimiento y regeneración de enlaces.
  - Validez legal (Ley 25.506) y sello de seguridad.

• **Gestión y Auditoría:**
  - Autoguardado continuo en tiempo real.
  - Rechazar candidato y anular links pendientes.
  - Descargar PDF oficial firmado.`,
      suggestions: [
        '¿Cómo cargo un nuevo candidato?',
        '¿Cómo funciona el Informe de Entrevista?',
        '¿Cómo enviar a firmar por WhatsApp?',
        '¿Cómo funciona el autoguardado continuo?'
      ]
    };
  }

  if (!q) {
    return {
      reply: '¡Hola! ¿En qué puedo ayudarte hoy con el panel de carátulas o el informe de entrevista?',
      suggestions: [
        '¿Cómo cargo un nuevo candidato?',
        '¿Cómo funciona el Informe de Entrevista?',
        '¿Cómo funciona el autoguardado continuo?',
        '¿Cómo enviar la carátula a firmar por WhatsApp?'
      ]
    };
  }

  // 1. Saludos
  if (/^(hola|buen dia|buenos dias|buenas tardes|buenas noches|buenas|hey|que tal|como va|hola como estas)\b/.test(q)) {
    return {
      reply: '¡Hola! Estoy acá para ayudarte con cualquier duda sobre la carga de candidatos, carátulas oficiales, informe de competencias, autoguardado o firmas por WhatsApp. ¿Sobre qué tema te gustaría consultar?',
      suggestions: [
        '¿Cómo cargo un nuevo candidato?',
        '¿Cómo funciona el Informe de Entrevista?',
        '¿Cómo funciona el autoguardado continuo?',
        '¿Cómo enviar a firmar por WhatsApp?'
      ]
    };
  }

  // 2. Agradecimiento o cierre
  if (/^(gracias|muchas gracias|genial|perfecto|joya|excelente|impecable|ok|listo|entendido|mil gracias)\b/.test(q)) {
    return {
      reply: '¡De nada! Cualquier otra duda que te surja mientras trabajás con los candidatos o informes, escribime cuando quieras. ¡Muchos éxitos con las búsquedas!',
      suggestions: [
        '¿Cómo funciona el autoguardado continuo?',
        '¿Cómo funciona el Informe de Entrevista?',
        '¿Qué validez legal tiene la firma?'
      ]
    };
  }

  // 3. Buscar mejor coincidencia en FAQ_TOPICS
  let bestTopic = null;
  let maxScore = 0;

  for (const topic of FAQ_TOPICS) {
    let score = 0;
    for (const rawTrigger of topic.triggers) {
      const trigger = cleanQuery(rawTrigger);
      if (q === trigger) {
        score += 30; // match exacto
      } else if (q.includes(trigger)) {
        score += trigger.length + 5;
      } else {
        // Coincidencia por palabras individuales
        const words = trigger.split(/\s+/).filter(w => w.length > 3);
        for (const w of words) {
          if (q.includes(w)) score += 3;
        }
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestTopic = topic;
    }
  }

  if (bestTopic && maxScore > 4) {
    const suggestions = (bestTopic.suggestions && Array.isArray(bestTopic.suggestions) && bestTopic.suggestions.length)
      ? bestTopic.suggestions
      : FAQ_TOPICS.filter(t => t.id !== bestTopic.id).slice(0, 3).map(t => t.title.replace(/^[^\w¿]+/, ''));

    return {
      reply: bestTopic.reply,
      suggestions: suggestions
    };
  }

  // 4. Respuesta general orientativa con sugerencias directas
  return {
    reply: `Entiendo tu consulta sobre "${rawQ}".

Para orientarte paso a paso, podés elegir uno de los temas más frecuentes o preguntarme con más detalle:

• **Carga de candidatos:** Cómo subir el CV en PDF y extraer datos automáticamente.
• **Carátula GSB:** Cómo completarla, agregar la foto de ingreso y condiciones de contratación.
• **Informe de Entrevista:** Cómo usar las 13 competencias STAR, calificar grados (A, B, C, D, PV) y descargar en A4.
• **Autoguardado:** Cómo se guardan tus avances en tiempo real sin perder nada.
• **Firmas por WhatsApp:** Cómo enviar los links directos a los directores para que firmen desde el celular.
• **Rechazar candidatos:** Cómo asentar el rechazo y anular links pendientes.
• **Descargar PDF:** Dónde obtener la carátula firmada con sello digital.

Si se trata de un inconveniente técnico con el servidor, podés avisarle directamente a Milton.`,
    suggestions: [
      '¿Cómo cargo un nuevo candidato?',
      '¿Cómo funciona el Informe de Entrevista?',
      '¿Cómo funciona el autoguardado continuo?',
      '¿Cómo enviar a firmar por WhatsApp?'
    ]
  };
}
