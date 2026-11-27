/* 极端输入性能测试：每项 20 万字，超过阈值即失败（防止正则回溯卡死再次出现）
   用法：node stress.js [阈值毫秒，默认 2000] [字数，默认 20 万] */
const E = require('./engine.js');
const LIMIT = +(process.argv[2] || 2000), N = +(process.argv[3] || 200000);
const rep = s => s.repeat(Math.ceil(N / s.length)).slice(0, N);
const cases = {
  'A.': rep('A.'), '空格': rep(' '), '制表符': rep('\t'), '换行': rep('\n'), 'CRLF': rep('\r\n'),
  '连续数字': rep('1'), '数字空格': rep('1 '), '单位万元+123,': '单位：万元\n' + rep('123,'), '千分位': rep('1,234 '),
  '小数点': rep('1.'), '连续字母': rep('a'), '大写空格': rep('A '), '浙江省杭州市': rep('浙江省杭州市') + '开发区',
  '省市区': rep('省市区'), '汉字': rep('的'), '顿号人名': rep('张、'), '百分号': rep('1%'), '@': rep('a@'),
  '加号': rep('+1'), '邮箱样': rep('a.b@c.'), '表格行': rep('营业收入\t128,600\t12.4%\n'), '英文词': rep('Hello World '),
  '通过和': rep('通过和'), '跨行短名': rep('有限公\n司'), '跨行括注': rep('（集团）\n'), '中文数字': rep('一亿二千万'), '发言人': rep('张伟：好\n'), '聊天时间': rep('张伟 10:32\n'), '股东为': rep('股东为甲乙、'), '金额占比单行': rep('1,234 5.0% '), '混合': rep('张伟A1.，'), '全角空格': rep('　'), '换行空白': rep('\n \t'), '换行全角': rep('\n　')
};
let fail = 0;
for (const [k, v] of Object.entries(cases)) {
  const t = Date.now();
  E.createEngine(null).mask(v);
  const d = Date.now() - t;
  const bad = d > LIMIT;
  if (bad) fail++;
  console.log(`${bad ? '✗' : '✓'} ${k.padEnd(12, '　')} ${String(d).padStart(6)} ms`);
}
if (fail) { console.log(`\n${fail} 项超过 ${LIMIT} ms`); process.exit(1); }
console.log(`\n全部 ${Object.keys(cases).length} 项在 ${LIMIT} ms 内`);
