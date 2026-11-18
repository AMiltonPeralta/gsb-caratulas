import zlib from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* ── PNG mínimo para firmas de ejemplo ─────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Dibuja una firma manuscrita sintética (para demos y ejemplos). */
export function makeSignaturePng(width = 620, height = 190) {
  const rgba = Buffer.alloc(width * height * 4);
  const setPixel = (x, y, alpha = 255) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    rgba[i] = 16;
    rgba[i + 1] = 32;
    rgba[i + 2] = 38;
    rgba[i + 3] = Math.max(rgba[i + 3], alpha);
  };

  const stroke = (points, thickness = 2.1) => {
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        const cx = x0 + (x1 - x0) * t;
        const cy = y0 + (y1 - y0) * t;
        for (let dx = -thickness; dx <= thickness; dx += 0.7) {
          for (let dy = -thickness; dy <= thickness; dy += 0.7) {
            if (dx * dx + dy * dy <= thickness * thickness) setPixel(cx + dx, cy + dy);
          }
        }
      }
    }
  };

  const baseY = height * 0.62;
  const points = [];
  for (let i = 0; i <= 220; i += 1) {
    const t = i / 220;
    const x = 40 + t * (width - 90);
    const y =
      baseY +
      Math.sin(t * Math.PI * 3.1) * 26 * (1 - t * 0.35) -
      Math.sin(t * Math.PI) * 14;
    points.push([x, y]);
  }
  stroke(points, 2);

  // Lazo inicial
  stroke(
    Array.from({ length: 70 }, (_, i) => {
      const a = (i / 70) * Math.PI * 2;
      return [110 + Math.cos(a) * 34, baseY - 12 + Math.sin(a) * 30];
    }),
    1.6,
  );

  // Subrayado
  stroke(
    Array.from({ length: 60 }, (_, i) => [70 + i * 8, height * 0.86 + Math.sin(i / 6) * 1.6]),
    1.2,
  );

  return encodePng(width, height, rgba);
}

/** Foto de ingreso de muestra: silueta neutra, sin datos de una persona real. */
export function makeAvatarPng(width = 300, height = 360) {
  const rgba = Buffer.alloc(width * height * 4);
  const bg = [238, 240, 243];
  const ink = [172, 180, 191];

  const blend = (x, y, color, alpha) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    for (let c = 0; c < 3; c += 1) {
      rgba[i + c] = Math.round(rgba[i + c] * (1 - alpha) + color[c] * alpha);
    }
    rgba[i + 3] = Math.max(rgba[i + 3], Math.round(255 * alpha));
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) blend(x, y, bg, 1);
  }

  const fillCircle = (cx, cy, radius) => {
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y += 1) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x += 1) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= radius - 1) blend(x, y, ink, 1);
        else if (d < radius + 1) blend(x, y, ink, (radius + 1 - d) / 2);
      }
    }
  };

  const fillEllipse = (cx, cy, rx, ry) => {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y += 1) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x += 1) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d <= 0.985) blend(x, y, ink, 1);
        else if (d < 1.015) blend(x, y, ink, (1.015 - d) / 0.03);
      }
    }
  };

  fillCircle(width / 2, height * 0.37, width * 0.19);
  fillEllipse(width / 2, height * 1.04, width * 0.38, height * 0.34);

  return encodePng(width, height, rgba);
}

/* ── CV de ejemplo ────────────────────────────────────────────────────── */

export const demoCandidate = {
  id: 101,
  full_name: 'Lucía Fernández',
  position: 'Gerente de Operaciones',
  area: 'Operaciones y planta',
  client: 'Industria alimenticia',
  seniority: 'Semi senior · 8 años',
  salary: '$3.200.000 brutos',
  start_date: '30 días desde la oferta',
  linkedin: 'linkedin.com/in/lucia-fernandez-demo',
  notes: 'Experiencia en plantas de producción, liderazgo de equipos de 40 personas, disponibilidad para viajar.',
  // Campos fijos de la carátula de ingreso GSB.
  age: '34 años',
  branch: 'Casa Central',
  selected_by: 'Pérez, Carolina',
  technical_test: 'Aprobada',
  cultural_fit: '8/10',
  job_function: 'Gerente de Operaciones',
  sector: 'Operaciones',
  national_manager: 'Sosa, Martín',
  branch_manager: 'Pérez, Carolina',
  direct_leader: 'Sosa, Martín',
  recruitment_sources: JSON.stringify(['Portal de Empleo', 'Referido']),
  position_type: 'reemplazo',
  replaces_name: 'Gómez, Marcelo',
  agreement_category: 'Gerencial',
  gsb_category: 'G-3',
  schedule: 'Lunes a viernes de 8 a 17 h',
  cct: 'Comercio',
  overtime: 'NO',
  corporate_card: 'SI',
  gross_salary: '3200000',
  net_salary: '2400000',
  value_added: '10',
  observations: 'Prepaga y vehículo asignado.',
  summary_text: [
    'PERFIL:',
    'Licenciada en Administración con 8 años de experiencia en operaciones de plantas alimenticias. Se destacó por liderar equipos de hasta 40 personas y por implementar mejoras de productividad en líneas de envasado.',
    '',
    'EXPERIENCIA:',
    '• Gerente de Producción — Molinos del Sur (2021–2026)',
    '• Jefa de Planta — Alimentos Pampeanos (2018–2021)',
    '• Analista de procesos — Consultora Logística Andina (2016–2018)',
    '',
    'FORMACIÓN:',
    '• Licenciatura en Administración, UBA',
    '• Posgrado en Gestión de Operaciones, UTDT',
    '',
    'PUNTOS FUERTES:',
    '• Liderazgo de equipos grandes en entornos de alta exigencia.',
    '• Mejora continua y control de indicadores de producción.',
    '• Manejo de presupuestos y negociación con proveedores.',
  ].join('\n'),
  created_at: new Date().toISOString(),
  cv_file_path: null,
};

export async function buildSampleCvPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const ink = rgb(0.08, 0.1, 0.12);
  const muted = rgb(0.42, 0.46, 0.5);
  const accent = rgb(0.06, 0.3, 0.36);

  page.drawRectangle({ x: 0, y: 780, width: 595.28, height: 61.89, color: accent });
  page.drawText('LUCÍA FERNÁNDEZ', { x: 56, y: 806, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Gerente de Operaciones · Operaciones y planta', { x: 56, y: 790, size: 10, font, color: rgb(0.85, 0.93, 0.95) });

  page.drawText('PERFIL', { x: 56, y: 740, size: 9, font: bold, color: accent });
  page.drawText('Licenciada en Administración (UBA) con posgrado en Gestión de Operaciones (UTDT).', { x: 56, y: 724, size: 10, font, color: ink });
  page.drawText('Ocho años de experiencia liderando plantas de producción y equipos de hasta 40 personas.', { x: 56, y: 709, size: 10, font, color: ink });

  page.drawText('EXPERIENCIA', { x: 56, y: 670, size: 9, font: bold, color: accent });
  const jobs = [
    ['Gerente de Producción', 'Molinos del Sur · 2021–2026'],
    ['Jefa de Planta', 'Alimentos Pampeanos · 2018–2021'],
    ['Analista de procesos', 'Consultora Logística Andina · 2016–2018'],
  ];
  let y = 650;
  for (const [role, company] of jobs) {
    page.drawText(role, { x: 56, y, size: 11, font: bold, color: ink });
    page.drawText(company, { x: 56, y: y - 13, size: 9.5, font, color: muted });
    y -= 42;
  }

  page.drawText('FORMACIÓN', { x: 56, y: 490, size: 9, font: bold, color: accent });
  page.drawText('Licenciatura en Administración — Universidad de Buenos Aires', { x: 56, y: 472, size: 10, font, color: ink });
  page.drawText('Posgrado en Gestión de Operaciones — Universidad Torcuato Di Tella', { x: 56, y: 457, size: 10, font, color: ink });

  page.drawText('REFERENCIAS', { x: 56, y: 410, size: 9, font: bold, color: accent });
  page.drawText('Disponibles a pedido.', { x: 56, y: 394, size: 10, font, color: muted });

  page.drawText('CV de ejemplo generado para la demo del sistema de carátulas.', {
    x: 56,
    y: 60,
    size: 8,
    font,
    color: muted,
  });

  return pdf.save();
}
