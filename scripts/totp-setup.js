import { generateTotpSecret, totpUri } from '../src/passwords.js';
import { config } from '../src/config.js';

const secret = generateTotpSecret();

console.log('');
console.log('Doble factor (TOTP)');
console.log('');
console.log('1. Abrí Google Authenticator, Authy o 1Password.');
console.log('2. Agregá una cuenta nueva y pegá este secreto:');
console.log('');
console.log('   ' + secret);
console.log('');
console.log('   O usá este enlace otpauth://:');
console.log('');
console.log('   ' + totpUri(secret, config.adminName));
console.log('');
console.log('3. Guardá el secreto en .env:');
console.log('');
console.log('   ADMIN_TOTP_SECRET=' + secret);
console.log('');
console.log('4. Reiniciá la app. El login va a pedir el código de 6 dígitos.');
console.log('');
console.log('Guardá una copia del secreto en un lugar seguro: si lo perdés,');
console.log('podés quitar ADMIN_TOTP_SECRET del .env y volver a ingresar con la clave.');
console.log('');
