// PDF 提取质量测量（开发用）：与 pdftotext 对比缺字率和耗时
// 用法：node bench-pdf.js 文件1.pdf 文件2.pdf ...   （需要本机装有 pdftotext）
// 口径：去掉空白和页码标记后，按"字符出现次数"比较。
//   缺字率 = pdftotext 有、本工具没有的字符数 / pdftotext 字符总数
//   多字率 = 本工具有、pdftotext 没有的字符数 / 本工具字符总数
// 这个口径不衡量顺序；顺序和折行拼接靠 test-pdf.js 和人工抽查。
const fs = require('fs');
const { execFileSync } = require('child_process');
const P = require('./pdf.js');

const bag = s => { const m = new Map(); for (const c of s.replace(/\s/g, '')) m.set(c, (m.get(c) || 0) + 1); return m; };
const total = m => { let n = 0; for (const v of m.values()) n += v; return n; };
const inter = (a, b) => { let n = 0; for (const [k, v] of a) n += Math.min(v, b.get(k) || 0); return n; };

(async () => {
  for (const f of process.argv.slice(2)) {
    const t0 = Date.now();
    const r = await P.extract(fs.readFileSync(f));
    const ms = Date.now() - t0;
    const ref = execFileSync('pdftotext', ['-enc', 'UTF-8', f, '-'], { maxBuffer: 1 << 28 }).toString('utf8');
    const a = bag(r.text.replace(/—— 第 \d+ 页 ——/g, '')), b = bag(ref);
    const both = inter(a, b);
    const miss = 1 - both / total(b), extra = 1 - both / total(a);
    console.log(`${f.split('/').pop().padEnd(28)} ${String(r.pages).padStart(4)} 页 ${String(ms).padStart(5)} ms  缺字率 ${(miss * 100).toFixed(2)}%  多字率 ${(extra * 100).toFixed(2)}%`);
  }
})();
