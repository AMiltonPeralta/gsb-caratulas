import express from 'express';
import path from 'node:path';
import { config, assertProductionConfig, securityWarnings } from './config.js';
import { runMigrations } from './migrate.js';
import { ensureAuditChain } from './db.js';
import { initCloudSync } from './cloud-sync.js';
import { securityHeaders, enforceHttps, checkHost, securityTxt, robotsTxt } from './security.js';
import adminRoutes from './routes/admin.js';
import signRoutes from './routes/sign.js';

runMigrations();
await initCloudSync();
ensureAuditChain();
assertProductionConfig();

const app = express();
app.set('trust proxy', config.trustProxy);
app.set('view engine', 'ejs');
app.set('views', path.join(config.root, 'views'));
app.disable('x-powered-by');

app.use(enforceHttps);
app.use(checkHost);
app.use(securityHeaders);

app.get('/.well-known/security.txt', securityTxt);
app.get('/robots.txt', robotsTxt);

app.use(
  express.static(path.join(config.root, 'public'), {
    maxAge: 0,
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '4mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/', (req, res) => res.redirect('/admin'));

app.get('/seguridad', (req, res) => {
  res.render('public/security', {
    title: 'Seguridad y privacidad',
    company: config.companyName,
    secure: res.locals.secure,
    contact: config.securityContact,
    baseUrl: config.baseUrl,
  });
});

app.use(signRoutes);
app.use(adminRoutes);

app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/') || req.path.startsWith('/f/')) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  return res.status(404).render('admin/not-found', { adminName: config.adminName });
});

app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  const status = Number(err?.status || err?.statusCode) || 500;
  const isApi = req.path.startsWith('/api/') || req.path.startsWith('/admin/api/');
  if (isApi) {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'El cuerpo de la solicitud no es válido.' });
    }
    return res.status(status).json({ error: 'Ocurrió un error. Probá de nuevo.' });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send('El archivo supera el límite de 12 MB.');
  }
  return res.status(status >= 400 && status < 600 ? status : 500).render('error', {
    title: 'Algo salió mal',
    message: 'Ocurrió un error inesperado. Si persiste, avisale a Milton.',
    company: config.companyName,
  });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log('');
  console.log(`  Carátulas y firmas · ${config.companyName}`);
  console.log(`  Panel:  ${config.baseUrl}/admin`);
  console.log(`  Local:  http://localhost:${config.port}/admin`);
  console.log(`  Entorno: ${process.env.NODE_ENV ?? 'development'} · IA: ${config.aiProvider}`);
  if (config.adminTotpSecret) console.log('  Doble factor: activo');
  const warnings = securityWarnings();
  if (warnings.length) {
    console.log('');
    console.log('  Avisos de seguridad:');
    for (const warning of warnings) console.log(`   · ${warning}`);
  }
  console.log('');
});
