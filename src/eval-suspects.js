/* v2.2 评测：疑似实体候选
   - 自动召回：引擎直接脱掉的
   - 确认后召回：假设用户把候选全部确认（候选文本与期望实体相同或互相包含）
   - 候选准确率：候选里有多少是真实体（给用户的负担）
   用法：node eval-suspects.js testset-real-dev.json [--verbose] */
const fs = require('fs'), path = require('path');
const E = require('./engine.js');
const f = process.argv.find(a => a.endsWith('.json'));
const verbose = process.argv.includes('--verbose');
const set = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
let n = 0, auto = 0, conf = 0, sugTotal = 0, sugTrue = 0, chars = 0;
const byType = {};
const bad = [];
for (const c of set.cases) {
  const r = E.createEngine(null).mask(c.text);
  chars += c.text.length;
  const sug = r.suggestions || [];
  sugTotal += sug.length;
  for (const s of sug) {
    const ok = (c.expect || []).some(x => x.text === s.alias || x.text.indexOf(s.alias) >= 0 || s.alias.indexOf(x.text) >= 0);
    if (ok) sugTrue++; else bad.push(`[${c.id}] ${s.type}:${s.alias}（${s.why}）`);
  }
  for (const x of c.expect || []) {
    const t = byType[x.type] = byType[x.type] || { n: 0, auto: 0, conf: 0 };
    n++; t.n++;
    const masked = r.masked.indexOf(x.text) < 0;
    const viaSug = sug.some(s => x.text === s.alias || x.text.indexOf(s.alias) >= 0 || s.alias.indexOf(x.text) >= 0);
    if (masked) { auto++; t.auto++; }
    if (masked || viaSug) { conf++; t.conf++; }
  }
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0') + '%';
console.log(`${f}：${set.cases.length} 例 / ${n} 个实体 / ${chars} 字`);
console.log(`  自动召回     ${pct(auto, n)}`);
console.log(`  确认后召回   ${pct(conf, n)}`);
console.log(`  候选数       ${sugTotal}（每万字 ${(sugTotal / chars * 1e4).toFixed(1)} 个），候选准确率 ${pct(sugTrue, sugTotal)}`);
console.log('  按类型（自动 → 确认后）：' + Object.entries(byType).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${k} ${pct(v.auto, v.n)}→${pct(v.conf, v.n)}`).join('  '));
if (verbose && bad.length) console.log('  非实体候选：\n    ' + bad.join('\n    '));
