#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 src/engine.js 内联进 src/ui.html，产出可分发的单文件 HTML。

用法：python3 build.py
产物：../脱敏工作台.html（单文件，双击即用，无需联网与安装）
"""
import os
import time

VERSION = "v1.9"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC_UI = os.path.join(HERE, "ui.html")
SRC_ENGINE = os.path.join(HERE, "engine.js")
SRC_LEXICON = os.path.join(HERE, "lexicon.js")
OUT = os.path.join(ROOT, "脱敏工作台.html")


def main():
    with open(SRC_UI, encoding="utf-8") as f:
        ui = f.read()
    with open(SRC_ENGINE, encoding="utf-8") as f:
        engine = f.read()
    with open(SRC_LEXICON, encoding="utf-8") as f:
        lexicon = f.read()

    if "/*__ENGINE__*/" not in ui:
        raise SystemExit("ui.html 里找不到 /*__ENGINE__*/ 占位符")

    stamp = time.strftime("%Y-%m-%d")
    # 词库必须在引擎之前求值（引擎启动时会读取全局 DemaskLexicon）
    out = ui.replace("/*__ENGINE__*/", "/* 引擎内联于 " + stamp + " */\n" + lexicon + "\n" + engine)
    out = out.replace("__VERSION__", VERSION)

    # 防御：内联后不能出现会提前闭合脚本的字符串
    if "</script" in (engine + lexicon).lower():
        raise SystemExit("engine.js 中含有 </script 字样，需转义后再内联")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)

    kb = len(out.encode("utf-8")) / 1024
    print(f"已生成 {OUT}  ({kb:.0f} KB, {VERSION})")


if __name__ == "__main__":
    main()
