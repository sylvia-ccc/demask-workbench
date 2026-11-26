// Office 深度清理的回归测试：正文以外的角落（属性、批注、修订、页眉页脚、图表、内嵌表格、
// 工作表名、公式缓存、链接、图片说明、缩略图）都不能留下客户名、人名和原始金额
// 用法：node test-office.js
const fs = require('fs');
const path = require('path');
const E = require('./engine.js');

const DIR = path.join(__dirname, 'fixtures-office');
const SECRETS = ['华润万佳', '张伟', '李明', '王芳', '深圳优鲜', 'crvanguard'];
const NUMBERS = ['128600', '152300', '8600', '10900', '98000', '257200'];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗ ' + m); } };

// 最小的 zip 读取（只为测试：Node 自带 zlib 解压）
function unzip(buf) {
  const zlib = require('zlib');
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const n = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    const ds = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.slice(ds, ds + csize);
    files[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    off += 46 + nlen + elen + clen;
  }
  return files;
}
const decode = s => s.replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// 粗略检查 XML 标签是否配对（防止改坏文件）
function wellFormed(xml) {
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g;
  let m;
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  while ((m = re.exec(body)) !== null) {
    if (m[3]) continue;
    if (m[1]) { if (stack.pop() !== m[2]) return false; }
    else stack.push(m[2]);
  }
  return stack.length === 0;
}

function scan(buf, prefix, hits, bad) {
  const files = unzip(buf);
  for (const [n, data] of Object.entries(files)) {
    if (/\.(xlsx|docx|pptx)$/.test(n) && data[0] === 0x50) { scan(data, prefix + n + '!', hits, bad); continue; }
    if (/thumbnail/.test(n)) hits.push(prefix + n + '：缩略图');
    if (!/\.(xml|rels)$/.test(n)) continue;
    const raw = data.toString('utf8');
    if (!wellFormed(raw)) bad.push(prefix + n);
    const t = decode(raw);
    for (const s of SECRETS) if (t.indexOf(s) >= 0) hits.push(prefix + n + '：' + s);
    for (const s of NUMBERS) if (new RegExp('[>"]' + s + '(?:\\.0+)?[<"]').test(t)) hits.push(prefix + n + '：' + s);
  }
}

(async () => {
  for (const f of ['leaky.docx', 'leaky.xlsx', 'leaky.pptx']) {
    const buf = fs.readFileSync(path.join(DIR, f));
    const eng = E.createEngine();
    const r = await E.maskOfficeFile(f, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), eng);
    const out = Buffer.from(await r.blob.arrayBuffer());
    const hits = [], bad = [];
    scan(out, '', hits, bad);
    ok(hits.length === 0, f + ' 仍有残留：' + hits.slice(0, 8).join('；'));
    ok(bad.length === 0, f + ' XML 被改坏：' + bad.join('；'));
    const c = r.stats.clean;
    if (f === 'leaky.docx') {
      for (const k of ['meta', 'authors', 'comments', 'revisions', 'headers', 'links', 'alt', 'thumbnail']) ok(c[k] > 0, f + ' 没有清理：' + k);
    }
    if (f === 'leaky.xlsx') {
      for (const k of ['meta', 'sheets', 'comments', 'headers', 'names']) ok(c[k] > 0, f + ' 没有清理：' + k);
      // 工作表改名后，引用它的公式要一起改
      const wbx = unzip(out);
      const s2 = decode(wbx['xl/worksheets/sheet2.xml'].toString('utf8'));
      const name = decode(wbx['xl/workbook.xml'].toString('utf8')).match(/<sheet\b[^>]*name="([^"]*)"/)[1];
      ok(s2.indexOf("'" + name + "'!B2") >= 0, '公式没有跟着工作表改名：' + name);
      ok(/fullCalcOnLoad="1"/.test(wbx['xl/workbook.xml'].toString('utf8')), '没有设置打开时重算');
    }
    if (f === 'leaky.pptx') {
      for (const k of ['meta', 'charts', 'embedded', 'thumbnail']) ok(c[k] > 0, f + ' 没有清理：' + k);
      // 图表缓存和背后的内嵌表格：缩放后的数字要一致
      const px = unzip(out);
      const chart = px['ppt/charts/chart1.xml'].toString('utf8');
      const nums = (chart.match(/<c:numCache>[\s\S]*?<\/c:numCache>/) || [''])[0].match(/<c:v>([^<]*)<\/c:v>/g) || [];
      const emb = Object.keys(px).find(n => /embeddings\/.*\.xlsx$/.test(n));
      const sheet = unzip(px[emb])['xl/worksheets/sheet1.xml'].toString('utf8');
      for (const v of nums) ok(sheet.indexOf('<v>' + v.replace(/<\/?c:v>/g, '') + '</v>') >= 0, '图表与内嵌表格数字不一致：' + v);
    }
  }
  // 复杂工作簿与文档（互相引用的多张表、三维引用、条件格式、数据验证、重名冲突、域代码、customXml、文本框）
  const MORE_SECRETS = ['华润万佳', '张伟', '王芳', '赵强', '深圳优鲜', 'crvanguard', 'zhangwei'];
  for (const f of ['vd-real.xlsx', 'vd-real-lo.xlsx', 'vd-collide.xlsx', 'vd-real.docx']) {
    const buf = fs.readFileSync(path.join(DIR, f));
    const r = await E.maskOfficeFile(f, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), E.createEngine());
    const out = Buffer.from(await r.blob.arrayBuffer());
    const files = unzip(out);
    const left = [], bad = [];
    for (const [n, d] of Object.entries(files)) {
      if (!/\.(xml|rels)$/.test(n)) continue;
      const raw = d.toString('utf8');
      if (!wellFormed(raw)) bad.push(n);
      const t = decode(raw);
      let t2 = t; try { t2 = decodeURIComponent(t); } catch (e) { }
      for (const s of MORE_SECRETS) if (t.indexOf(s) >= 0 || t2.indexOf(s) >= 0) left.push(n + '：' + s);
    }
    ok(left.length === 0 || r.stats.warnings.some(w => /没有改名/.test(w)), f + ' 仍有残留：' + left.slice(0, 6).join('；'));
    ok(bad.length === 0, f + ' XML 被改坏：' + bad.join('；'));
    if (/xlsx$/.test(f)) {
      const wb = decode(files['xl/workbook.xml'].toString('utf8'));
      const sheets = [...wb.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map(m => m[1]);
      ok(new Set(sheets.map(x => x.toLowerCase())).size === sheets.length, f + ' 工作表重名：' + sheets.join(' / '));
      const names = [...wb.matchAll(/<definedName\b[^>]*name="([^"]*)"/g)].map(m => m[1]);
      ok(new Set(names.map(x => x.toLowerCase())).size === names.length, f + ' 定义名称重名：' + names.join(' / '));
      // 每个公式里引用的表名，都必须真实存在
      const all = Object.entries(files).filter(([n]) => /\.xml$/.test(n)).map(([n, d]) => decode(d.toString('utf8'))).join('\n');
      const refs = new Set();
      for (const m of all.matchAll(/<(?:f|formula1?|definedName|xm:f)\b[^>]*>([^<]*)</g)) {
        const fx = m[1].replace(/"(?:[^"]|"")*"/g, '');
        for (const q of fx.matchAll(/'((?:[^']|'')+)'!/g)) q[1].replace(/''/g, "'").split(':').forEach(x => refs.add(x));
        for (const q of fx.matchAll(/(?:^|[^\w.\u4e00-\u9fa5'】])([\w.\u4e00-\u9fa5【】]+(?::[\w.\u4e00-\u9fa5【】]+)?)!/g)) q[1].split(':').forEach(x => refs.add(x));
      }
      for (const x of refs) ok(sheets.indexOf(x) >= 0, f + ' 公式引用了不存在的表：' + x);
    }
  }

  console.log(`\nOffice 测试 通过 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
