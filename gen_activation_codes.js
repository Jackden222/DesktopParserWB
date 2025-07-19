const fs = require('fs');

function randomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const codes = new Set();
while (codes.size < 300) {
  codes.add(randomCode());
}

const sql = Array.from(codes).map(code =>
  `insert into public.activation_codes (code) values ('${code}');`
).join('\n');

fs.writeFileSync('activation_codes.sql', sql, 'utf8');
console.log('Готово! Сгенерировано 300 кодов и сохранено в activation_codes.sql'); 