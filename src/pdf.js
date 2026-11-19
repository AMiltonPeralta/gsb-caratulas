import fs from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { config } from './config.js';
import { formatDateTime } from './util.js';
import {
  GSB_COMPANY,
  GSB_COMPANY_SUB,
  GSB_DOC_SUB,
  GSB_DOC_TITLE,
  GSB_SOURCES,
  formatMoney,
  matchSignatureBlocks,
} from './gsb.js';

const A4 = [595.28, 841.89];
const MARGIN = 28;
const CONTENT_W = A4[0] - MARGIN * 2;

const RED = rgb(200 / 255, 16 / 255, 46 / 255);
const RED_SOFT = rgb(251 / 255, 234 / 255, 236 / 255);
const INK = rgb(0.102, 0.102, 0.102);
const MUTED = rgb(0.353, 0.373, 0.416);
const LINE = rgb(241 / 255, 201 / 255, 207 / 255);
const HAIR = rgb(0.86, 0.87, 0.89);
const FIELD_BG = rgb(1, 0.965, 0.969);
const WHITE = rgb(1, 1, 1);
const EMPTY = rgb(0.64, 0.65, 0.67);

function sanitize(text) {
  return String(text ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, '-')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[^\x20-\x7E\xA1-\xFF\n]/g, '');
}

function oneLine(text) {
  return sanitize(text).replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function wrap(text, font, size, maxWidth) {
  const lines = [];
  const paragraphs = sanitize(text).split('\n');
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        line = test;
      } else {
        if (line) lines.push(line);
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        } else {
          line = word;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function fit(text, font, size, maxWidth) {
  let value = oneLine(text);
  if (!value) return '';
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  while (value.length > 1 && font.widthOfTextAtSize(`${value}...`, size) > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value.trimEnd()}...`;
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 10)}...${hash.slice(-6)}` : '—';
}

class Layout {
  constructor(pdf, font, bold) {
    this.pdf = pdf;
    this.font = font;
    this.bold = bold;
    this.page = null;
    this.y = 0;
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage(A4);
    this.page.font = this.font;
    this.page.bold = this.bold;
    this.y = A4[1] - MARGIN;
    return this.page;
  }

  runningHeader() {
    this.page.drawText(sanitize(GSB_COMPANY), {
      x: MARGIN,
      y: A4[1] - 26,
      size: 9,
      font: this.bold,
      color: RED,
    });
    this.page.drawText(sanitize(`${GSB_DOC_TITLE} · uso interno`), {
      x: A4[0] - MARGIN - 92,
      y: A4[1] - 26,
      size: 6.4,
      font: this.font,
      color: MUTED,
    });
    this.page.drawLine({
      start: { x: MARGIN, y: A4[1] - 33 },
      end: { x: A4[0] - MARGIN, y: A4[1] - 33 },
      thickness: 1,
      color: LINE,
    });
    this.y = A4[1] - 46;
  }

  ensure(height) {
    if (this.y - height < MARGIN) {
      this.newPage();
      this.runningHeader();
    }
  }
}

function drawCoverHeader(layout) {
  const { page, font, bold } = layout;
  const top = A4[1];

  page.drawText(sanitize(GSB_COMPANY), {
    x: MARGIN,
    y: top - 40,
    size: 20,
    font: bold,
    color: RED,
  });
  page.drawText(sanitize(GSB_COMPANY_SUB.toUpperCase()), {
    x: MARGIN,
    y: top - 52,
    size: 6.2,
    font,
    color: MUTED,
  });

  const title = sanitize(GSB_DOC_TITLE.toUpperCase());
  const titleSize = 13;
  page.drawText(title, {
    x: A4[0] - MARGIN - bold.widthOfTextAtSize(title, titleSize),
    y: top - 38,
    size: titleSize,
    font: bold,
    color: INK,
  });
  const sub = sanitize(GSB_DOC_SUB);
  page.drawText(sub, {
    x: A4[0] - MARGIN - font.widthOfTextAtSize(sub, 6.8),
    y: top - 50,
    size: 6.8,
    font,
    color: MUTED,
  });

  page.drawLine({
    start: { x: MARGIN, y: top - 64 },
    end: { x: A4[0] - MARGIN, y: top - 64 },
    thickness: 2.4,
    color: RED,
  });
  layout.y = top - 76;
}

/** Franja roja de rechazo: deja el motivo y el autor dentro del documento. */
function drawRejectionBanner(layout, candidate) {
  const { page, font, bold } = layout;
  const reason = oneLine(candidate.rejection_reason || '');
  const lines = wrap(reason || 'Sin motivo registrado', font, 6.4, CONTENT_W - 20).slice(0, 2);
  const height = 30 + lines.length * 8;
  layout.ensure(height + 6);
  const top = layout.y;

  page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_W, height, color: RED });
  page.drawText('CANDIDATO RECHAZADO', {
    x: MARGIN + 10,
    y: top - 13,
    size: 9,
    font: bold,
    color: WHITE,
  });
  const meta = `Rechazado por ${candidate.rejected_by || 'Directorio'} · ${formatDateTime(candidate.rejected_at)}`;
  page.drawText(fit(meta, font, 6.4, CONTENT_W - 20), {
    x: MARGIN + 10,
    y: top - 23,
    size: 6.4,
    font,
    color: WHITE,
  });
  lines.forEach((line, index) => {
    page.drawText(fit(`Motivo: ${line}`, font, 6.4, CONTENT_W - 20), {
      x: MARGIN + 10,
      y: top - 33 - index * 8,
      size: 6.4,
      font,
      color: WHITE,
    });
  });

  layout.y = top - height - 7;
}

function section(layout, num, title, height, drawBody) {
  layout.ensure(height + 6);
  const { page, font, bold } = layout;
  const top = layout.y;
  const width = CONTENT_W;

  page.drawRectangle({
    x: MARGIN,
    y: top - height,
    width,
    height,
    color: WHITE,
    borderColor: LINE,
    borderWidth: 0.7,
  });
  page.drawRectangle({ x: MARGIN, y: top - 20, width, height: 20, color: RED });

  page.drawCircle({ x: MARGIN + 13, y: top - 10, size: 5.6, color: WHITE });
  page.drawText(String(num), {
    x: MARGIN + (num > 9 ? 9.4 : 11.4),
    y: top - 12.6,
    size: 7.4,
    font: bold,
    color: RED,
  });
  page.drawText(sanitize(title.toUpperCase()), {
    x: MARGIN + 24,
    y: top - 13.4,
    size: 8.3,
    font: bold,
    color: WHITE,
  });

  drawBody({ page, x: MARGIN + 9, y: top - 28, w: width - 18, top, height });
  layout.y = top - height - 7;
}

function drawField(page, { x, y, w, label, value, accent = false }) {
  const { font, bold } = page;
  page.drawText(fit(label.toUpperCase(), bold, 5.2, w), {
    x,
    y,
    size: 5.2,
    font: bold,
    color: MUTED,
  });
  page.drawRectangle({
    x,
    y: y - 15,
    width: w,
    height: 11.5,
    color: accent ? RED_SOFT : FIELD_BG,
    borderColor: rgb(0.93, 0.93, 0.93),
    borderWidth: 0.4,
  });
  const display = value ? fit(value, font, 7.6, w - 6) : '—';
  page.drawText(display, {
    x: x + 3,
    y: y - 12.4,
    size: 7.6,
    font,
    color: value ? (accent ? RED : INK) : EMPTY,
  });
}

function drawCheck(page, x, y, checked) {
  page.drawRectangle({
    x,
    y,
    width: 7,
    height: 7,
    color: checked ? RED : WHITE,
    borderColor: checked ? RED : rgb(0.72, 0.75, 0.78),
    borderWidth: 0.5,
  });
  if (checked) {
    page.drawLine({ start: { x: x + 1.5, y: y + 3.5 }, end: { x: x + 2.9, y: y + 1.7 }, thickness: 0.8, color: WHITE });
    page.drawLine({ start: { x: x + 2.9, y: y + 1.7 }, end: { x: x + 5.4, y: y + 5.4 }, thickness: 0.8, color: WHITE });
  }
}

function drawToggle(page, { x, y, width, label, on }) {
  page.drawRectangle({
    x,
    y,
    width,
    height: 15,
    color: on ? RED : FIELD_BG,
    borderColor: on ? RED : rgb(0.81, 0.83, 0.85),
    borderWidth: 0.6,
  });
  const text = fit(label.toUpperCase(), page.bold, 6.4, width - 6);
  page.drawText(text, {
    x: x + (width - page.bold.widthOfTextAtSize(text, 6.4)) / 2,
    y: y + 5,
    size: 6.4,
    font: page.bold,
    color: on ? WHITE : MUTED,
  });
}

/** Campo de opciones fijas (NO / SI) con la elegida resaltada. */
function drawChoice(page, { x, y, w, label, value, options = ['NO', 'SI'] }) {
  page.drawText(fit(label.toUpperCase(), page.bold, 5.2, w), {
    x,
    y,
    size: 5.2,
    font: page.bold,
    color: MUTED,
  });
  const gap = 4;
  const boxW = (w - gap * (options.length - 1)) / options.length;
  const selected = oneLine(value).toUpperCase();
  options.forEach((option, index) => {
    const bx = x + index * (boxW + gap);
    const on = selected === option;
    page.drawRectangle({
      x: bx,
      y: y - 15,
      width: boxW,
      height: 11.5,
      color: on ? RED : FIELD_BG,
      borderColor: on ? RED : rgb(0.81, 0.83, 0.85),
      borderWidth: 0.6,
    });
    const text = sanitize(option);
    page.drawText(text, {
      x: bx + (boxW - page.bold.widthOfTextAtSize(text, 6.6)) / 2,
      y: y - 12.4,
      size: 6.6,
      font: page.bold,
      color: on ? WHITE : MUTED,
    });
  });
}

function drawSignatureBlock(page, { x, y, w, h, role, request, image, highlight }) {
  const { font, bold } = page;
  page.drawRectangle({
    x,
    y: y - h,
    width: w,
    height: h,
    color: WHITE,
    borderColor: highlight ? RED : LINE,
    borderWidth: highlight ? 1.2 : 0.7,
  });
  page.drawText(fit(role.toUpperCase(), bold, 6.6, w - 10), {
    x: x + 5,
    y: y - 11,
    size: 6.6,
    font: bold,
    color: INK,
  });
  page.drawLine({
    start: { x: x + 5, y: y - 15 },
    end: { x: x + w - 5, y: y - 15 },
    thickness: 1.4,
    color: RED,
  });

  if (request) {
    page.drawText(fit(request.signer?.name || '', font, 6.8, w - 10), {
      x: x + 5,
      y: y - 25,
      size: 6.8,
      font,
      color: INK,
    });

    if (request.signature) {
      if (image) {
        const maxW = w - 14;
        const maxH = 22;
        const scale = Math.min(maxW / image.width, maxH / image.height);
        page.drawImage(image, {
          x: x + (w - image.width * scale) / 2,
          y: y - 53,
          width: image.width * scale,
          height: image.height * scale,
        });
      }
      const dniVal = request.signature.dni || request.signer?.dni;
      if (dniVal) {
        page.drawText(`DNI ${sanitize(dniVal)}`, {
          x: x + 5,
          y: y - h + 19,
          size: 5.2,
          font: bold,
          color: INK,
        });
      }
      page.drawText(`Firmado ${sanitize(formatDateTime(request.signature.signed_at))}`, {
        x: x + 5,
        y: y - h + 12,
        size: 5.1,
        font,
        color: MUTED,
      });
      page.drawText(`SHA-256 ${shortHash(request.signature.signature_hash || request.signature.document_hash)}`, {
        x: x + 5,
        y: y - h + 5.5,
        size: 4.8,
        font,
        color: MUTED,
      });
    } else {
      const label =
        request.id === highlight
          ? 'Pendiente de tu firma'
          : request.status === 'expired'
            ? 'Link vencido'
            : request.status === 'revoked'
              ? 'Solicitud anulada'
              : 'Pendiente de firma';
      page.drawRectangle({
        x: x + 5,
        y: y - h + 18,
        width: w - 10,
        height: 22,
        color: highlight ? RED_SOFT : rgb(0.985, 0.985, 0.99),
        borderColor: highlight ? RED : HAIR,
        borderWidth: 0.5,
        borderDashArray: [2, 2],
      });
      page.drawText(fit(label, bold, 6, w - 16), {
        x: x + 8,
        y: y - h + 27,
        size: 6,
        font: bold,
        color: highlight ? RED : MUTED,
      });
    }
  } else {
    page.drawRectangle({
      x: x + 5,
      y: y - h + 18,
      width: w - 10,
      height: 22,
      color: rgb(0.985, 0.985, 0.99),
      borderColor: HAIR,
      borderWidth: 0.5,
      borderDashArray: [2, 2],
    });
    page.drawText('Sin asignar', {
      x: x + 8,
      y: y - h + 27,
      size: 6,
      font,
      color: EMPTY,
    });
  }
}

async function embedPhoto(pdf, candidate) {
  let bytes = null;
  let isPng = false;

  if (candidate.photo_data) {
    try {
      bytes = Buffer.from(candidate.photo_data, 'base64');
      isPng = candidate.photo_mime === 'image/png';
    } catch {}
  } else if (candidate.photo_path && fs.existsSync(candidate.photo_path)) {
    try {
      bytes = fs.readFileSync(candidate.photo_path);
      isPng = candidate.photo_path.toLowerCase().endsWith('.png');
    } catch {}
  }

  if (!bytes) return null;

  try {
    return isPng
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes);
  } catch (err) {
    console.warn('[pdf] no se pudo leer la foto del ingreso:', err.message);
    return null;
  }
}

async function embedSignatures(pdf, requests) {
  const map = new Map();
  for (const request of requests) {
    const signature = request.signature;
    if (!signature?.signature_image_path) continue;
    if (!fs.existsSync(signature.signature_image_path)) continue;
    try {
      map.set(request.id, await pdf.embedPng(fs.readFileSync(signature.signature_image_path)));
    } catch {
      /* firma ilegible */
    }
  }
  return map;
}

function drawSection1(layout, candidate, gsb, photo) {
  section(layout, 1, 'Datos del postulante', 158, ({ page, x, y, w }) => {
    // Foto del ingreso
    const photoW = 92;
    const photoH = 118;
    page.drawRectangle({
      x,
      y: y - photoH + 6,
      width: photoW,
      height: photoH,
      color: FIELD_BG,
      borderColor: LINE,
      borderWidth: 0.7,
    });
    if (photo) {
      const scale = Math.min((photoW - 4) / photo.width, (photoH - 4) / photo.height);
      page.drawImage(photo, {
        x: x + (photoW - photo.width * scale) / 2,
        y: y - photoH + 6 + (photoH - photo.height * scale) / 2,
        width: photo.width * scale,
        height: photo.height * scale,
      });
    } else {
      const label = 'FOTO DEL INGRESO';
      page.drawText(label, {
        x: x + (photoW - page.bold.widthOfTextAtSize(label, 5.2)) / 2,
        y: y - photoH / 2 + 2,
        size: 5.2,
        font: page.bold,
        color: EMPTY,
      });
    }

    const fx = x + photoW + 12;
    const fw = w - photoW - 12;
    const gap = 8;
    const colW = (fw - gap) / 2;
    const rows = [
      [['Postulante (apellido, nombre)', gsb.full_name, 'full']],
      [
        ['Edad', gsb.age],
        ['Sucursal / Localidad', gsb.branch],
      ],
      [
        ['Seleccionado por', gsb.selected_by],
        ['Prueba técnica', gsb.technical_test],
      ],
      [
        ['Fit cultural', gsb.cultural_fit],
        ['Función', gsb.job_function],
      ],
      [
        ['Sector', gsb.sector],
        ['Área', gsb.area],
      ],
      [
        ['Responsable nacional', gsb.national_manager],
        ['Responsable sector / sucursal', gsb.branch_manager],
      ],
      [['Líder / Tutor directo', gsb.direct_leader, 'full']],
    ];

    let rowY = y;
    for (const row of rows) {
      if (row.length === 1 && row[0][2] === 'full') {
        drawField(page, { x: fx, y: rowY, w: fw, label: row[0][0], value: row[0][1] });
      } else {
        row.forEach((field, index) => {
          drawField(page, {
            x: fx + index * (colW + gap),
            y: rowY,
            w: colW,
            label: field[0],
            value: field[1],
          });
        });
      }
      rowY -= 16.4;
    }
  });
}

function drawSection2(layout, gsb) {
  section(layout, 2, 'Fuentes de reclutamiento', 112, ({ page, x, y, w }) => {
    const leftW = w * 0.58;
    const colW = (leftW - 10) / 2;
    GSB_SOURCES.forEach((source, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const cx = x + col * (colW + 10);
      const cy = y - row * 14.5;
      drawCheck(page, cx, cy - 1, (gsb.sources || []).includes(source));
      page.drawText(fit(source, page.font, 6.4, colW - 12), {
        x: cx + 10,
        y: cy,
        size: 6.4,
        font: page.font,
        color: INK,
      });
    });

    const rx = x + leftW + 14;
    const rw = w - leftW - 14;
    page.drawText('TIPO DE PUESTO', {
      x: rx,
      y,
      size: 5.2,
      font: page.bold,
      color: MUTED,
    });
    const toggleW = (rw - 6) / 2;
    drawToggle(page, { x: rx, y: y - 20, width: toggleW, label: 'Puesto nuevo', on: gsb.position_type === 'nuevo' });
    drawToggle(page, {
      x: rx + toggleW + 6,
      y: y - 20,
      width: toggleW,
      label: 'Reemplazo',
      on: gsb.position_type === 'reemplazo',
    });

    if (gsb.position_type === 'reemplazo' && gsb.replaces_name) {
      drawField(page, { x: rx, y: y - 40, w: rw, label: 'Reemplaza a (apellido, nombre)', value: gsb.replaces_name });
    }
  });
}

function drawSection3(layout, gsb) {
  section(layout, 3, 'Condiciones de contratación', 128, ({ page, x, y, w }) => {
    const gap = 8;
    const colW = (w - gap * 2) / 3;
    const fields = [
      ['Categoría convenio', gsb.agreement_category],
      ['Categoría Grúas San Blas', gsb.gsb_category],
      ['Horario', gsb.schedule],
      ['CCT', gsb.cct],
      ['Horas extra', gsb.overtime, 'choice'],
      ['Tarjeta corporativa', gsb.corporate_card, 'choice'],
      ['Sueldo bruto ($)', gsb.gross_salary ? formatMoney(gsb.gross_salary) : ''],
      ['Sueldo neto ($)', gsb.net_salary ? formatMoney(gsb.net_salary) : ''],
      ['Valor agregado', gsb.value_added ? `${gsb.value_added} %` : ''],
    ];
    fields.forEach((field, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const box = {
        x: x + col * (colW + gap),
        y: y - row * 17.4,
        w: colW,
        label: field[0],
        value: field[1],
      };
      if (field[2] === 'choice') drawChoice(page, box);
      else drawField(page, { ...box, accent: index === 8 });
    });

    const obsY = y - 3 * 17.4 - 2;
    page.drawText('OBSERVACIONES', { x, y: obsY, size: 5.2, font: page.bold, color: MUTED });
    page.drawRectangle({
      x,
      y: obsY - 25,
      width: w,
      height: 20,
      color: FIELD_BG,
      borderColor: rgb(0.93, 0.93, 0.93),
      borderWidth: 0.4,
    });
    const lines = wrap(gsb.observations || '—', page.font, 6.6, w - 6).slice(0, 2);
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: x + 3,
        y: obsY - 11 - index * 7.6,
        size: 6.6,
        font: page.font,
        color: gsb.observations ? INK : EMPTY,
      });
    });
  });
}

function signatureLayout(requests) {
  const matched = matchSignatureBlocks(requests);
  const renderGroups = matched.groups.map((group) => ({
    label: group.label,
    blocks: group.blocks,
  }));
  // Las firmas cuyo rol no coincide con los bloques fijos no se pierden: van
  // en un bloque "Otras firmas" para que el PDF firmado siga siendo completo.
  if (matched.extras.length) {
    renderGroups.push({
      label: 'Otras firmas',
      blocks: matched.extras.map((request) => ({
        scope: request.signer?.scope || 'central',
        role: request.signer?.role || 'Firma',
        request,
      })),
    });
  }
  return renderGroups;
}

async function drawSection4(layout, requests, images, highlightId) {
  const groups = signatureLayout(requests);
  const blockH = 74;
  const rowGap = 6;
  const groupTitleH = 16;
  const groupGap = 4;
  const introH = 16;
  const padding = 28;

  const height =
    padding +
    introH +
    groups.reduce(
      (acc, group) => acc + groupTitleH + Math.ceil(group.blocks.length / 2) * (blockH + rowGap) + groupGap,
      0,
    );

  section(layout, 4, 'Aprobaciones y firmas', height, ({ page, x, y, w }) => {
    page.drawText(
      'Cada aprobador firma electrónicamente en su bloque. La fecha, la hora y el código SHA-256 quedan registrados.',
      { x, y, size: 5.8, font: page.font, color: MUTED },
    );

    let cursor = y - introH;
    for (const group of groups) {
      const title = group.label.toUpperCase();
      page.drawRectangle({ x, y: cursor - 12, width: w, height: 12, color: RED });
      page.drawText(title, {
        x: x + (w - page.bold.widthOfTextAtSize(title, 6.4)) / 2,
        y: cursor - 9,
        size: 6.4,
        font: page.bold,
        color: WHITE,
      });
      cursor -= groupTitleH;

      const cols = 2;
      const blockW = (w - 8) / cols;
      group.blocks.forEach((block, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        drawSignatureBlock(page, {
          x: x + col * (blockW + 8),
          y: cursor - row * (blockH + rowGap),
          w: blockW,
          h: blockH,
          role: block.role,
          request: block.request,
          image: block.request ? images.get(block.request.id) : null,
          highlight: Boolean(block.request && block.request.id === highlightId),
        });
      });
      cursor -= Math.ceil(group.blocks.length / cols) * (blockH + rowGap) + groupGap;
    }
  });
}

function drawLegal(layout, template) {
  const { page, font, bold } = layout;
  layout.ensure(70);
  const y = layout.y;
  const lines = wrap(template.legalText || '', font, 5.6, CONTENT_W);
  let legalY = y - 4;
  for (const line of lines.slice(0, 5)) {
    page.drawText(line, { x: MARGIN, y: legalY, size: 5.6, font, color: MUTED });
    legalY -= 7.4;
  }
  page.drawLine({ start: { x: MARGIN, y: legalY - 2 }, end: { x: A4[0] - MARGIN, y: legalY - 2 }, thickness: 0.5, color: LINE });
  page.drawText(fit(template.footerNote || '', font, 5.6, CONTENT_W - 90), {
    x: MARGIN,
    y: legalY - 12,
    size: 5.6,
    font,
    color: MUTED,
  });
  page.drawText(`CAR-${String(layout.candidateId ?? 0).padStart(5, '0')}`, {
    x: A4[0] - MARGIN - 66,
    y: legalY - 12,
    size: 5.6,
    font: bold,
    color: MUTED,
  });
  layout.y = legalY - 20;
}

function drawAnexo(layout, candidate, template) {
  layout.newPage();
  layout.runningHeader();
  const { page, bold, font } = layout;
  const top = layout.y;

  page.drawRectangle({ x: MARGIN, y: top - 20, width: CONTENT_W, height: 20, color: RED });
  const title = sanitize((template.summaryTitle || 'ANEXO · RESUMEN DEL CANDIDATO').toUpperCase());
  page.drawText(title, { x: MARGIN + 10, y: top - 13.4, size: 8.3, font: bold, color: WHITE });
  layout.y = top - 34;

  const identity = [
    ['Postulante', candidate.full_name],
    ['Sucursal', candidate.branch],
    ['Función', candidate.job_function || candidate.position],
    ['Sector', candidate.sector],
  ].filter((item) => item[1]);

  if (identity.length) {
    const gap = 10;
    const colW = (CONTENT_W - gap * (identity.length - 1)) / identity.length;
    identity.forEach((item, index) => {
      drawField(page, {
        x: MARGIN + index * (colW + gap),
        y: layout.y,
        w: colW,
        label: item[0],
        value: item[1],
      });
    });
    layout.y -= 28;
  }

  const lines = candidate.summary_text
    ? wrap(candidate.summary_text, font, 8.6, CONTENT_W)
    : ['Sin resumen cargado.'];

  let lastPage = page;
  for (const line of lines) {
    if (layout.y < MARGIN + 18) {
      layout.newPage();
      layout.runningHeader();
      layout.page.drawText(sanitize(`${title} (continuación)`), {
        x: MARGIN,
        y: layout.y,
        size: 7,
        font: bold,
        color: RED,
      });
      layout.y -= 16;
    }
    if (line) {
      layout.page.drawText(line, { x: MARGIN, y: layout.y, size: 8.6, font, color: INK });
    }
    layout.y -= 11.6;
    lastPage = layout.page;
  }

  // Nota de verificación del anexo.
  if (layout.y > MARGIN + 30) {
    layout.y -= 10;
    lastPage.drawText(
      'El resumen es de consulta. La firma se estampa sobre la carátula y el PDF completo queda sellado con SHA-256.',
      { x: MARGIN, y: layout.y, size: 5.8, font, color: MUTED },
    );
  }
}

function drawInterviewReport(layout, candidate) {
  let report = null;
  if (candidate.interview_report_json) {
    try {
      report = JSON.parse(candidate.interview_report_json);
    } catch {
      report = null;
    }
  }
  if (!report || !report.fields) return;

  const f = report.fields;
  const comps = report.comps || {};

  layout.newPage();
  layout.runningHeader();
  const { page, bold, font } = layout;
  const top = layout.y;

  page.drawRectangle({ x: MARGIN, y: top - 20, width: CONTENT_W, height: 20, color: RED });
  page.drawText('INFORME DE ENTREVISTA · MODELO DE TALENTO GSB', {
    x: MARGIN + 10,
    y: top - 13.4,
    size: 8.3,
    font: bold,
    color: WHITE,
  });
  layout.y = top - 32;

  // Cabecera de datos
  const idRows = [
    [['Candidato', f.name || candidate.full_name], ['Empresa', f.company || 'Grúas San Blas'], ['Función', f.function || candidate.job_function || '—']],
    [['Sucursal', f.branch || candidate.branch || '—'], ['Sector / Área', `${f.sector || '—'} · ${f.area || '—'}`], ['Fecha/Hora', `${f.date || '—'} ${f.time || ''}`]],
    [['Entrevistador', f.interviewer || '—'], ['Fuente', f.source || '—'], ['Educación', `${f.education || '—'} ${f.educationDetail || ''}`]],
    [['Transporte / Traslado', `${f.transport || '—'} (${f.commute || '—'})`], ['Pretensión / Disp.', `${f.salary || '—'} · ${f.availability || '—'}`], ['Fit Cultural / Técnica', `${f.fitNA === 'true' ? 'N/A' : (f.fitResult || '—')} · ${f.testNA === 'true' ? 'N/A' : (f.testResult ? `${f.testResult}/100` : '—')}`]],
  ];

  const colW = (CONTENT_W - 16) / 3;
  for (const row of idRows) {
    row.forEach((item, idx) => {
      drawField(page, {
        x: MARGIN + idx * (colW + 8),
        y: layout.y,
        w: colW,
        label: item[0],
        value: item[1],
      });
    });
    layout.y -= 26;
  }

  // Ajuste técnico, excluyentes y aclaraciones
  layout.y -= 4;
  page.drawText('AJUSTE TÉCNICO Y RESULTADOS', { x: MARGIN, y: layout.y, size: 7.2, font: bold, color: RED });
  layout.y -= 12;

  const techItems = [
    ['Requisitos excluyentes', f.requirements],
    ['Conocimientos técnicos', f.technical],
    ['Resultados / aporte', f.results],
    ['Aclaraciones', f.clarifications],
  ].filter(i => i[1]);

  for (const item of techItems) {
    const textLines = wrap(`${item[0]}: ${item[1]}`, font, 7.5, CONTENT_W);
    for (const tl of textLines.slice(0, 2)) {
      page.drawText(tl, { x: MARGIN, y: layout.y, size: 7.5, font, color: INK });
      layout.y -= 10;
    }
  }

  // Competencias evaluadas
  layout.y -= 4;
  page.drawText('COMPETENCIAS EVALUADAS', { x: MARGIN, y: layout.y, size: 7.2, font: bold, color: RED });
  layout.y -= 12;

  const compEntries = Object.entries(comps).filter(([_, c]) => c.answer && c.answer.trim());
  if (compEntries.length) {
    for (const [k, c] of compEntries.slice(0, 7)) {
      const g = c.grade || 'PV';
      const label = `${k} [${g}]: `;
      const ans = fit(c.answer, font, 7.2, CONTENT_W - 45);
      page.drawText(label, { x: MARGIN, y: layout.y, size: 7.2, font: bold, color: INK });
      page.drawText(ans, { x: MARGIN + 42, y: layout.y, size: 7.2, font, color: MUTED });
      layout.y -= 11;
    }
  } else {
    page.drawText('Sin competencias registradas con respuesta.', { x: MARGIN, y: layout.y, size: 7.2, font, color: MUTED });
    layout.y -= 11;
  }

  // Síntesis y resultado final
  layout.y -= 4;
  page.drawText('SÍNTESIS Y DECISIÓN', { x: MARGIN, y: layout.y, size: 7.2, font: bold, color: RED });
  layout.y -= 12;

  if (f.strengths) {
    page.drawText(`Fortalezas: ${fit(f.strengths, font, 7.2, CONTENT_W - 60)}`, { x: MARGIN, y: layout.y, size: 7.2, font, color: INK });
    layout.y -= 10;
  }
  if (f.risks) {
    page.drawText(`Oportunidades de mejora: ${fit(f.risks, font, 7.2, CONTENT_W - 110)}`, { x: MARGIN, y: layout.y, size: 7.2, font, color: INK });
    layout.y -= 10;
  }
  if (f.digital) {
    page.drawText(`Mentalidad digital / IA: ${fit(f.digital, font, 7.2, CONTENT_W - 105)}`, { x: MARGIN, y: layout.y, size: 7.2, font, color: INK });
    layout.y -= 10;
  }
  if (f.autonomy) {
    page.drawText(`Autonomía / productividad: ${fit(f.autonomy, font, 7.2, CONTENT_W - 115)}`, { x: MARGIN, y: layout.y, size: 7.2, font, color: INK });
    layout.y -= 10;
  }

  layout.y -= 4;
  page.drawRectangle({ x: MARGIN, y: layout.y - 20, width: CONTENT_W, height: 20, color: FIELD_BG, borderColor: LINE, borderWidth: 0.8 });
  page.drawText(`Resultado: ${sanitize(f.decision || 'Pendiente')}  ·  ${fit(f.conclusion || 'Sin conclusión registrada.', font, 7.5, CONTENT_W - 100)}`, {
    x: MARGIN + 8,
    y: layout.y - 13,
    size: 7.5,
    font: bold,
    color: INK,
  });
  layout.y -= 26;
}

function attachCv(pdf, candidate, width, height) {
  if (!candidate.cv_file_path || !fs.existsSync(candidate.cv_file_path)) return;
  const ext = candidate.cv_file_path.toLowerCase().split('.').pop();
  try {
    if (ext === 'pdf') {
      const cvBytes = fs.readFileSync(candidate.cv_file_path);
      // El CV se agrega sincrónicamente mediante una carga previa en buildCaratulaPdf.
      return cvBytes;
    }
    if (['png', 'jpg', 'jpeg'].includes(ext)) {
      return fs.readFileSync(candidate.cv_file_path);
    }
  } catch (err) {
    console.warn('[pdf] no se pudo leer el CV:', err.message);
  }
  return null;
}

export async function buildCaratulaPdf({ candidate, requests, template = config.coverTemplate }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(`${GSB_DOC_TITLE} — ${candidate.full_name}`);
  pdf.setAuthor(template.company || config.companyName);
  pdf.setSubject(`Carátula de ingreso de ${candidate.full_name} — Grúas San Blas`);
  pdf.setProducer('Firma de carátulas · Grúas San Blas');
  pdf.setCreationDate(new Date());

  const gsb = {
    full_name: candidate.full_name || '',
    age: candidate.age || '',
    branch: candidate.branch || '',
    selected_by: candidate.selected_by || '',
    technical_test: candidate.technical_test || '',
    cultural_fit: candidate.cultural_fit || '',
    job_function: candidate.job_function || candidate.position || '',
    sector: candidate.sector || '',
    area: candidate.area || '',
    national_manager: candidate.national_manager || '',
    branch_manager: candidate.branch_manager || '',
    direct_leader: candidate.direct_leader || '',
    sources: (() => {
      try {
        const raw = JSON.parse(candidate.recruitment_sources || '[]');
        return Array.isArray(raw) ? raw : [];
      } catch {
        return String(candidate.recruitment_sources || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
    })(),
    position_type: candidate.position_type || '',
    replaces_name: candidate.replaces_name || '',
    agreement_category: candidate.agreement_category || '',
    gsb_category: candidate.gsb_category || '',
    schedule: candidate.schedule || '',
    cct: candidate.cct || '',
    overtime: candidate.overtime || '',
    corporate_card: candidate.corporate_card || '',
    gross_salary: candidate.gross_salary || candidate.salary || '',
    net_salary: candidate.net_salary || '',
    value_added: candidate.value_added || '',
    observations: candidate.observations || '',
  };

  const layout = new Layout(pdf, font, bold);
  layout.candidateId = candidate.id;

  drawCoverHeader(layout);
  if (candidate.rejected_at) drawRejectionBanner(layout, candidate);
  const photo = await embedPhoto(pdf, candidate);
  drawSection1(layout, candidate, gsb, photo);
  drawSection2(layout, gsb);
  drawSection3(layout, gsb);

  const images = await embedSignatures(pdf, requests);
  await drawSection4(layout, requests, images, null);
  drawLegal(layout, template);

  // 1. CARÁTULA (Página 1 ya dibujada arriba)
  // 2. CV ENTERO (tal cual como se sube)
  if (candidate.cv_file_path && fs.existsSync(candidate.cv_file_path)) {
    const ext = candidate.cv_file_path.toLowerCase().split('.').pop();
    try {
      if (ext === 'pdf') {
        const cvDoc = await PDFDocument.load(fs.readFileSync(candidate.cv_file_path), { ignoreEncryption: true });
        const pages = await pdf.copyPages(cvDoc, cvDoc.getPageIndices());
        for (const p of pages) pdf.addPage(p);
      } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
        const bytes = fs.readFileSync(candidate.cv_file_path);
        const img = ext === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const imgPage = pdf.addPage(A4);
        const scale = Math.min((A4[0] - MARGIN * 2) / img.width, (A4[1] - MARGIN * 2) / img.height, 1);
        imgPage.drawImage(img, {
          x: (A4[0] - img.width * scale) / 2,
          y: (A4[1] - img.height * scale) / 2,
          width: img.width * scale,
          height: img.height * scale,
        });
      }
    } catch (err) {
      console.warn('[pdf] no se pudo adjuntar el CV:', err.message);
    }
  }

  // 3. INFORME DE ENTREVISTA (Modelo de talento GSB)
  drawInterviewReport(layout, candidate);

  // 4. ANEXO RESUMEN
  drawAnexo(layout, candidate, template);

  // Numeración general.
  const total = pdf.getPageCount();
  pdf.getPages().forEach((page, index) => {
    page.drawText(`Página ${index + 1} de ${total}`, {
      x: A4[0] - MARGIN - 58,
      y: 13,
      size: 5.4,
      font,
      color: MUTED,
    });
  });

  return pdf.save();
}

export async function buildSinglePagePreview(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes);
  const out = await PDFDocument.create();
  const [first] = await out.copyPages(doc, [0]);
  out.addPage(first);
  return out.save();
}
