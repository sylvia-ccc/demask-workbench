// 功能回归：日期平移（可还原、间隔不变）、规则包（加密、合并、去重）
// 用法：node test-features.js
const E = require('./engine.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗ ' + m); } };

(async () => {
  // ---- 日期平移 ----
  {
    const e = E.createEngine();
    const src = '签约日 2025年3月15日，交割日 2025-06-30，公告 2025/1/5，2025年全年收入 100 亿元，2月30日不是日期。';
    const m = e.mask(src, { date_shift: true });
    ok(m.masked.indexOf('2025年3月15日') < 0 && m.masked.indexOf('2025-06-30') < 0 && m.masked.indexOf('2025/1/5') < 0, '日期没有平移：' + m.masked);
    ok(/2025年全年/.test(m.masked) && /2月30日/.test(m.masked), '只有年份或无效日期也被改了：' + m.masked);
    const d = [...m.masked.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日|(\d{4})-(\d{2})-(\d{2})/g)];
    const t = x => x[1] ? Date.UTC(+x[1], x[2] - 1, +x[3]) : Date.UTC(+x[4], x[5] - 1, +x[6]);
    ok(d.length >= 2 && (t(d[1]) - t(d[0])) / 864e5 === 107, '平移后间隔天数变了');
    e.setOpts({ date_shift: true });
    ok(e.restore(m.masked) === src, '日期还原不一致：' + e.restore(m.masked));
    // AI 按平移后的日期推算出的新日期，也要换回（签约日 + 30 天）
    const sh = d.length ? (t(d[0]) - Date.UTC(2025, 2, 15)) / 864e5 : 0;
    const ai = new Date(Date.UTC(2025, 2, 15 + sh + 30));
    const aiTxt = '付款日为 ' + ai.getUTCFullYear() + '年' + (ai.getUTCMonth() + 1) + '月' + ai.getUTCDate() + '日';
    ok(e.restore(aiTxt) === '付款日为 2025年4月14日', 'AI 推算的日期没有换回：' + e.restore(aiTxt));
    // 原文里两个日期正好相差平移天数：不能互相串（以前逐个替换会把 6月30日 改成 3月31日）
    for (let k = 0; k < 30; k++) {
      const e2 = E.createEngine(); e2.setOpts({ date_shift: true });
      const src2 = '截至2025年6月30日、2025年3月31日、2024年12月31日；付款 2025-04-04，签约 2025-03-05；3月5日开会';
      const m2 = e2.mask(src2);
      if (e2.restore(m2.masked) !== src2) { ok(false, '日期串位：' + e2.restore(m2.masked)); break; }
      if (k === 29) ok(true, '');
    }
    ok(E.createEngine().mask(src, {}).masked.indexOf('2025年3月15日') >= 0, '默认不应平移日期');
  }

  // ---- 界面的真实调用方式：mask 传选项、restore 不调 setOpts ----
  {
    const e = E.createEngine();
    const src = '截至2025年6月30日、2025年3月31日，签约日 2025-03-05';
    const m = e.mask(src, { date_shift: true });
    ok(e.restore(m.masked) === src, '界面方式下日期没有还原：' + e.restore(m.masked));
    // 之后用户关掉平移、又脱敏了一段有日期的文字：再还原就不该动日期
    e.mask('另一份材料 2025-01-01', {});
    ok(e.restore('今天是 2025-04-04') === '今天是 2025-04-04', '关掉后还原仍在改日期');
  }

  // ---- 规则包 ----
  {
    const a = E.createEngine();
    a.addWord('ORG', '鹏城智造'); a.addWord('PERSON', '周慕言'); a.addRule('内部编号', 'PRJ-\\d{4}', 'PROJECT');
    const plain = await E.buildRulePack(a, { exclude: ['华东'], ignore: ['东方'] });
    ok(JSON.parse(plain).dict.ORG.indexOf('鹏城智造') >= 0, '明文规则包缺内容');
    const enc = await E.buildRulePack(a, {}, '口令123');
    ok(enc.indexOf('鹏城智造') < 0 && enc.indexOf('周慕言') < 0, '加密规则包里能看到名单');
    let need = false; try { await E.parseRulePack(enc); } catch (err) { need = !!err.needPass; }
    ok(need, '加密规则包没有要求口令');
    let bad = false; try { await E.parseRulePack(enc, '错的'); } catch (err) { bad = /口令不对/.test(err.message); }
    ok(bad, '错误口令没有被拒绝');
    const b = E.createEngine();
    const p = await E.parseRulePack(enc, '口令123');
    const n1 = E.applyRulePack(b, p), n2 = E.applyRulePack(b, p);
    ok(n1.ORG === 1 && n1.PERSON === 1 && n1.rules === 1, '规则包合并数量不对：' + JSON.stringify(n1));
    ok(n2.ORG === 0 && n2.PERSON === 0 && n2.rules === 0, '重复导入会重复添加');
    const m = b.mask('鹏城智造的周慕言，编号 PRJ-2025', {}).masked;
    ok(!/鹏城智造|周慕言|PRJ-2025/.test(m), '导入后没有生效：' + m);
    let junk = false; try { await E.parseRulePack('{"kind":"x"}'); } catch (err) { junk = true; }
    ok(junk, '不是规则包的文件没有被拒绝');
  }

  // ---- 自定义规则：危险写法和非法类型要拒绝 ----
  {
    const e = E.createEngine();
    for (const [pat, type] of [['(\\d+)+X', 'ORG'], ['((\\d+))+X', 'ORG'], ['(?:(?:\\d)+)+X', 'ORG'], ['(.*a){12}X', 'ORG'], ['(a|aa)+', 'ORG'], ['PRJ-\\d{4}', '__proto__'], ['PRJ-\\d{4}', 'constructor']]) {
      let rejected = false; try { e.addRule('x', pat, type); } catch (err) { rejected = true; }
      ok(rejected, '应当拒绝的规则被接受：' + pat + ' / ' + type);
    }
    for (const pat of ['PRJ-\\d{4}', '(?:ABC|XYZ)-\\d+', '[A-Z]{2}\\d{6}', '(?:\\d{1,3},)+\\d{3}', '(?:[A-Z]{2,4}-)+\\d+', '\\b[A-Z]{2,}(?:-[A-Z0-9]+)*\\b', '(?:\\d{4}-){3}\\d{4}']) {
      let fine = true; try { E.createEngine().addRule('x', pat, 'CONTRACT'); } catch (err) { fine = false; }
      ok(fine, '正常规则被拒绝：' + pat);
    }
    const t0 = Date.now(); e.mask('1'.repeat(40) + 'Y', {}); ok(Date.now() - t0 < 500, '自定义规则导致变慢');
  }

  console.log(`\n功能测试 通过 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
