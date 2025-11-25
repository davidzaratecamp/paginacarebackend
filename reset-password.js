import bcrypt from 'bcryptjs';

// Nueva contraseña que quieres usar
const newPassword = 'admin123';

// Generar hash
const saltRounds = 12;
const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

console.log('\n=== RESET PASSWORD ===');
console.log('Nueva contraseña:', newPassword);
console.log('Hash generado:', hashedPassword);
console.log('\nEjecuta este SQL para actualizar la contraseña:');
console.log(`UPDATE admins SET password = '${hashedPassword}' WHERE username = 'admin';`);
console.log('\n');
