# スプレッドシート（Excel .xlsx）の「在庫管理①」「縦積在庫管理②」を、取り込み用の JSON にする
# Python の標準の機能だけで読む（.xlsx は XML を zip にまとめたもの）
# 使い方: python3 -I scripts/sheet_to_json.py <Excelのファイル> <書き出す JSON>
import sys, zipfile, re, json
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}

def col(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1

def main(src, dst):
    z = zipfile.ZipFile(src)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for s in wb.find("m:sheets", NS):
        name = s.get("name")
        if name not in ("在庫管理①", "縦積在庫管理②"):
            continue  # ほかのシート（アカウント一覧など）は読まない
        t = rels[s.get("{%s}id" % NS["r"])].lstrip("/")
        t = t if t.startswith("xl/") else "xl/" + t
        rows = []
        for r in ET.fromstring(z.read(t)).iter("{%s}row" % NS["m"]):
            cells = {}
            for c in r.findall("m:c", NS):
                ty, v = c.get("t"), c.find("m:v", NS)
                if ty == "s" and v is not None:
                    val = ss[int(v.text)]
                elif ty == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
                else:
                    val = v.text if v is not None else None
                if val is not None:
                    cells[col(c.get("r"))] = val
            if cells:
                rows.append({"row": int(r.get("r")), "cells": [cells.get(i, "") for i in range(max(cells) + 1)]})
        out[name] = rows
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print({k: len(v) for k, v in out.items()})

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
