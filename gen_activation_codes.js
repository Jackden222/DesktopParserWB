function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function genCodes(n) {
  const set = new Set();
  while (set.size < n) set.add(genCode());
  return Array.from(set);
}

const codes1m = genCodes(500);
const codes3m = genCodes(500);

codes1m.forEach(c => console.log(`('${c}', '1month'),`));
codes3m.forEach(c => console.log(`('${c}', '3month'),`));