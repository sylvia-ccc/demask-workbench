#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""浏览器冒烟测试。

Node 单测只能验证引擎逻辑，验证不了：
  · 打包后脚本是否真的能在浏览器里跑起来（作用域、全局变量）
  · 受限环境（沙箱 iframe / 禁用存储）下会不会整页死掉
这两个问题都真实发生过，所以固化成脚本。

用法：python3 smoke.py
依赖：本机装有 Chrome；无第三方 Python 包。
"""
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(os.path.dirname(HERE), "脱敏工作台.html")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

SAMPLE = "华润万佳商业集团2025年营收128.6亿元，联系人张伟 13812345678。"

# 自测脚本：模拟"点掉引导 → 粘贴 → 等结果"，把结果写回页面，便于抓取
SELFTEST = """
<script>
setTimeout(function(){
  var d = [];
  try{
    var b = document.getElementById('btnWelcomeStart'); if (b) b.click();
    var inp = document.getElementById('input');
    inp.value = %s;
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    setTimeout(function(){
      var o = document.getElementById('output');
      var cap = document.getElementById('capbar');
      d.push('OUT=' + o.textContent.trim().slice(0, 24));
      d.push('ENT=' + document.getElementById('cEnt').textContent);
      d.push('CAP=' + (cap.classList.contains('on') ? 'on' : 'off'));
      d.push('ERR=' + JSON.stringify(window.__errs || []));
      o.textContent = 'DIAG>>>' + d.join('|');
    }, 1200);
  }catch(e){
    document.getElementById('output').textContent = 'DIAG>>>EXC=' + e.message;
  }
}, 600);
</script>
</body>"""


def run_case(name, inject_head=""):
    with open(APP, encoding="utf-8") as f:
        src = f.read()
    src = src.replace("</head>", inject_head + "</head>", 1)
    src = src.replace("</body>", SELFTEST % ("'" + SAMPLE + "'"))

    tmpdir = tempfile.mkdtemp(prefix="demask-smoke-")
    page = os.path.join(tmpdir, "case.html")
    with open(page, "w", encoding="utf-8") as f:
        f.write(src)

    profile = os.path.join(tmpdir, "profile")
    cmd = [CHROME, "--headless=new", "--no-sandbox", "--disable-gpu",
           "--user-data-dir=" + profile, "--virtual-time-budget=6000",
           "--dump-dom", "file://" + page]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    m = re.search(r"DIAG&gt;&gt;&gt;([^<]*)", out) or re.search(r"DIAG>>>([^<]*)", out)
    if not m:
        return False, "没有拿到诊断结果（页面可能没跑起来）"
    diag = html.unescape(m.group(1))

    ok = True
    notes = []
    if "OUT=【企业" not in diag:
        ok = False
        notes.append("脱敏结果为空或未脱敏")
    if "ENT=0" in diag:
        ok = False
        notes.append("实体数为 0")
    if "ERR=[]" not in diag:
        ok = False
        notes.append("有 JS 报错")
    if name == "受限环境" and "CAP=on" not in diag:
        ok = False
        notes.append("受限环境下没有给出提示")
    if name == "常规环境" and "CAP=on" in diag:
        notes.append("常规环境不应出现提示条")

    return ok, diag if ok else diag + " ← " + "；".join(notes)


def main():
    if not os.path.exists(CHROME):
        print("跳过：本机没有 Chrome")
        return 0
    if not os.path.exists(APP):
        print("找不到 " + APP + "，请先运行 build.py")
        return 1

    cases = [
        ("常规环境", '<script>window.__errs=[];window.addEventListener("error",function(e){'
                     '__errs.push(e.message+"@"+e.lineno);},true);</script>'),
        ("受限环境", '<script>window.__errs=[];window.addEventListener("error",function(e){'
                     '__errs.push(e.message+"@"+e.lineno);},true);'
                     'Object.defineProperty(window,"localStorage",{configurable:true,'
                     'get:function(){throw new DOMException("denied","SecurityError");}});</script>'),
    ]

    failed = 0
    for name, inject in cases:
        ok, msg = run_case(name, inject)
        print(("  ✓ " if ok else "  ✗ ") + name + "  " + msg[:150])
        if not ok:
            failed += 1

    print("\n冒烟测试：" + ("全部通过" if not failed else f"{failed} 项失败"))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
