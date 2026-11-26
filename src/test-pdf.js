// PDF 文字层提取的回归测试：编码、压缩、加密、版面还原、扫描件拦截、畸形输入
// 用法：node test-pdf.js
const fs = require('fs');
const path = require('path');
const P = require('./pdf.js');
const E = require('./engine.js');

const DIR = path.join(__dirname, 'fixtures-pdf');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('✗ ' + msg); } };

const MUST = [
  '星河远景科技股份有限公司（以下简称“星河远景”）2025 年实现营业收入 12.86 亿元',  // 折行后拼回一段
  '公司董事长周慕言表示',
  '营业收入\t128,600\t152,300',                                                     // 表格列用制表符分开
  'chen.kexin@xinghe-demo.com'
];

(async () => {
  for (const f of ['cid-predefined.pdf', 'ttf-tounicode.pdf', 'uncompressed.pdf',
    'enc-rc4-40.pdf', 'enc-rc4-128.pdf', 'enc-aes-128.pdf', 'enc-aes-256.pdf']) {
    let r;
    try { r = await P.extract(fs.readFileSync(path.join(DIR, f))); }
    catch (e) { ok(false, f + ' 抛错：' + e.message); continue; }
    ok(r.pages === 2, f + ' 页数应为 2，实际 ' + r.pages);
    for (const m of MUST) ok(r.text.indexOf(m) >= 0, f + ' 缺少：' + m.replace(/\t/g, '⇥'));
  }

  // 一行一个公司名的名单：不能拼成一串（拼了会让后面的名字整名漏脱）
  {
    const r = await P.extract(fs.readFileSync(path.join(DIR, 'name-list.pdf')));
    for (const n of ['深圳市鹏城智造科技有限公司', '杭州云栖智联有限公司', '上海星河远景有限公司', '蓝海数科有限公司']) {
      ok(r.text.split('\n').indexOf(n) >= 0, '名单行被拼接或丢失：' + n);
    }
    const m = E.createEngine().mask(r.text, {});
    for (const n of ['鹏城', '云栖', '星河', '蓝海']) ok(m.masked.indexOf(n) < 0, '名单脱敏后仍含：' + n);
  }

  // 中英文混排名单：英文名一行、中文名下一行，不能拼起来
  {
    const r = await P.extract(fs.readFileSync(path.join(DIR, 'name-list-bilingual.pdf')));
    const m = E.createEngine().mask(r.text, {});
    for (const n of ['鹏城智造', '云栖智联国际', '星河远景', '杭州云栖']) ok(m.masked.indexOf(n) < 0, '双语名单脱敏后仍含：' + n);
  }

  // 设置了打开密码：明确拒绝，不输出乱码
  try { await P.extract(fs.readFileSync(path.join(DIR, 'enc-user-password.pdf'))); ok(false, '有打开密码的 PDF 应当报错'); }
  catch (e) { ok(/打开密码/.test(e.message), '打开密码提示不对：' + e.message); }

  // 扫描件：明确拒绝
  try { await P.extract(fs.readFileSync(path.join(DIR, 'scanned.pdf'))); ok(false, '扫描件应当报错'); }
  catch (e) { ok(/扫描件/.test(e.message), '扫描件提示不对：' + e.message); }

  // 端到端：PDF → 脱敏，公司名、人名、邮箱、金额都要被替换
  const txt = await E.extractText('年报.pdf', fs.readFileSync(path.join(DIR, 'ttf-tounicode.pdf')));
  const m = E.createEngine().mask(txt, {});
  for (const leak of ['星河远景科技股份有限公司', '周慕言', 'chen.kexin@xinghe-demo.com', '12.86 亿元']) {
    ok(m.masked.indexOf(leak) < 0, '脱敏后仍含：' + leak);
  }

  // 畸形输入：不能卡死、不能抛出非 Error 的异常
  const bad = [
    Buffer.from('not a pdf at all'),
    Buffer.from('%PDF-1.7\n' + '1'.repeat(300000)),
    Buffer.from('%PDF-1.7\n1 0 obj\n' + '['.repeat(100000)),
    Buffer.from('%PDF-1.7\n1 0 obj << /Length 999999 >> stream\nabc'),
    fs.readFileSync(path.join(DIR, 'ttf-tounicode.pdf')).subarray(0, 20000)      // 截断
  ];
  for (let i = 0; i < bad.length; i++) {
    const t0 = Date.now();
    try { await P.extract(bad[i]); } catch (e) { ok(e instanceof Error, '畸形输入 ' + i + ' 抛出了非 Error'); }
    ok(Date.now() - t0 < 2000, '畸形输入 ' + i + ' 耗时 ' + (Date.now() - t0) + 'ms');
  }

  // 自带的 MD5 要和 Node 的一致（加密 PDF 靠它推导密钥）
  const crypto = require('crypto');
  for (const s of ['', 'abc', 'x'.repeat(1000)]) {
    const mine = Buffer.from(P._md5(new Uint8Array(Buffer.from(s)))).toString('hex');
    ok(mine === crypto.createHash('md5').update(s).digest('hex'), 'MD5 不一致：' + s.slice(0, 10));
  }

  console.log(`\nPDF 测试 通过 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
