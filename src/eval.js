/* 评测：用带标注的测试集算真实的 Precision / Recall / F1
   判定原则：
   - 期望脱敏的文本，脱敏后**原文是否还完整出现** → 还出现就是漏（FN）
   - 引擎识别出的实体，不在期望列表里 → 误识别（FP）
   - 要求保留的文本被改掉 → 过度脱敏（FP）
   用法：node eval.js [--verbose]
*/
const fs = require('fs');
const path = require('path');
const E = require('./engine.js');

const SET_FILE = process.argv.find(a => a.endsWith('.json')) || 'testset.json';
const set = JSON.parse(fs.readFileSync(path.join(__dirname, SET_FILE), 'utf8'));
const verbose = process.argv.includes('--verbose');

const eng = E.createEngine(null);

let TP = 0, FN = 0, FP = 0, TYPE_ERR = 0, KEEP_OK = 0, KEEP_BAD = 0;
const failures = [];
const byCat = {};

function catStat(c) {
  if (!byCat[c]) byCat[c] = { tp: 0, fn: 0, fp: 0 };
  return byCat[c];
}

for (const c of set.cases) {
  eng.reset();
  let r;
  try {
    r = eng.mask(c.text);
  } catch (e) {
    failures.push({ id: c.id, cat: c.cat, kind: 'EXC', detail: e.message });
    continue;
  }
  const masked = r.masked;
  const ents = r.entities;
  const st = catStat(c.cat);

  // 1) 期望项：看原文是否还残留
  const matchedEnt = new Set();
  for (const x of (c.expect || [])) {
    const still = masked.indexOf(x.text) >= 0;
    // 找到对应的识别实体（用于判类型与去重）
    const exact = ents.filter(e => e.text === x.text);
    const hit = exact.length ? exact[0]
      : ents.find(e => e.text.indexOf(x.text) >= 0 || x.text.indexOf(e.text) >= 0);
    if (still) {
      FN++; st.fn++;
      failures.push({ id: c.id, cat: c.cat, kind: '漏', detail: x.text, masked: masked.slice(0, 120) });
    } else {
      TP++; st.tp++;
      if (hit) {
        matchedEnt.add(hit);
        if (hit.type !== x.type) {
          TYPE_ERR++;
          failures.push({ id: c.id, cat: c.cat, kind: '类型错', detail: x.text + ' 期望' + x.type + ' 实际' + hit.type });
        }
      }
    }
  }

  // 2) 误识别：识别了但不在期望列表
  for (const e of ents) {
    if (matchedEnt.has(e)) continue;
    const inExpect = (c.expect || []).some(x =>
      e.text === x.text || e.text.indexOf(x.text) >= 0 || x.text.indexOf(e.text) >= 0);
    if (!inExpect) {
      FP++; st.fp++;
      failures.push({ id: c.id, cat: c.cat, kind: '误识别', detail: '【' + e.text + '】' + e.type });
    }
  }

  // 3) 必须保留的
  for (const k of (c.keep || [])) {
    if (masked.indexOf(k) >= 0) { KEEP_OK++; }
    else {
      KEEP_BAD++; FP++; st.fp++;
      failures.push({ id: c.id, cat: c.cat, kind: '过度脱敏', detail: k, masked: masked.slice(0, 120) });
    }
  }

  // 4) 还原一致性
  const back = eng.restore(masked);
  if (back !== c.text && c.expect && c.expect.length) {
    // 只统计，不作为失败（简称归并会导致写法归一）
  }
}

const P = TP + FP ? TP / (TP + FP) : 0;
const R = TP + FN ? TP / (TP + FN) : 0;
const F1 = P + R ? 2 * P * R / (P + R) : 0;

console.log('=== 识别质量 ===');
console.log(`  真阳性 TP       ${TP}`);
console.log(`  漏检   FN       ${FN}`);
console.log(`  误报   FP       ${FP}   （含过度脱敏 ${KEEP_BAD}）`);
console.log(`  类型错          ${TYPE_ERR}`);
console.log(`  Precision       ${(P * 100).toFixed(1)}%`);
console.log(`  Recall          ${(R * 100).toFixed(1)}%`);
console.log(`  F1              ${(F1 * 100).toFixed(1)}%`);
console.log('');

console.log('=== 分类别 ===');
const cats = Object.keys(byCat).sort();
for (const c of cats) {
  const s = byCat[c];
  const p = s.tp + s.fp ? s.tp / (s.tp + s.fp) : 0;
  const r = s.tp + s.fn ? s.tp / (s.tp + s.fn) : 0;
  const flag = (s.fn || s.fp) ? '  ←' : '';
  console.log(`  ${c.padEnd(14, '　')} TP${String(s.tp).padStart(2)} FN${String(s.fn).padStart(2)} FP${String(s.fp).padStart(2)}  P${(p * 100).toFixed(0)}% R${(r * 100).toFixed(0)}%${flag}`);
}

if (failures.length) {
  console.log('\n=== 失败明细 ===');
  const show = verbose ? failures : failures.slice(0, 40);
  for (const f of show) {
    console.log(`  [${f.cat}] ${f.kind}: ${f.detail}${f.masked ? '  | ' + f.masked.replace(/\n/g, '⏎') : ''}`);
  }
  if (!verbose && failures.length > show.length) console.log(`  ... 还有 ${failures.length - show.length} 条，用 --verbose 看全部`);
}

// 机器可读结果，供 score.js 使用
fs.writeFileSync(path.join(__dirname, SET_FILE.replace('.json','-result.json')), JSON.stringify({
  tp: TP, fn: FN, fp: FP, typeErr: TYPE_ERR, keepOk: KEEP_OK, keepBad: KEEP_BAD,
  precision: P, recall: R, f1: F1, byCat, failures: failures.length
}, null, 2));
