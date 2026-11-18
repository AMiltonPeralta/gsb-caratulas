import { hashPassword } from '../src/passwords.js';

const password = process.argv[2];

if (!password) {
  console.error('');
  console.error('Uso:');
  console.error('  npm run security:hash -- "una clave larga y única"');
  console.error('');
  console.error('Después copiá el resultado en ADMIN_PASSWORD_HASH del .env');
  console.error('y borrá ADMIN_PASSWORD.');
  console.error('');
  process.exit(1);
}

try {
  const hash = hashPassword(password);
  console.log('');
  console.log('ADMIN_PASSWORD_HASH=' + hash);
  console.log('');
  console.log('Guardá esa línea en .env. No la compartas.');
  console.log('');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
