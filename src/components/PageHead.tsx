"use client";
// 画面の見出し（どの画面も同じ形）：題名と、ひとことの数字、「？ 使い方」（押したときだけ説明を出す）
import { useState } from "react";

export function PageHead({ title, sub, help, children }: {
  title: React.ReactNode;
  /** 題名の横に小さく出すひとこと（件数・レートなど） */
  sub?: React.ReactNode;
  /** 「？ 使い方」を押すと出る説明（箇条書き1行ずつ） */
  help?: React.ReactNode[];
  /** 右側に置くボタンなど */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="pagehead">
        <h1>{title}{sub && <span className="headcount">{sub}</span>}</h1>
        <div className="pagehead-r">
          {children}
          {help && help.length > 0 && (
            <button className="linkbtn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "使い方を閉じる" : "？ 使い方"}</button>
          )}
        </div>
      </div>
      {open && help && <ul className="helpcard">{help.map((h, i) => <li key={i}>{h}</li>)}</ul>}
    </>
  );
}
