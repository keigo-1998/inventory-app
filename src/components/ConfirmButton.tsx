"use client";

import { useTransition } from "react";

export function ConfirmButton({
  action,
  confirm: message,
  children,
  className = "btn btn-sm",
}: {
  action: () => Promise<void>;
  confirm?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => {
        if (message && !window.confirm(message)) return;
        start(async () => {
          try {
            await action();
          } catch (e) {
            if (e instanceof Error && !("digest" in e && String(e.digest).startsWith("NEXT_REDIRECT"))) alert(e.message);
            else throw e;
          }
        });
      }}
    >
      {pending ? "処理中…" : children}
    </button>
  );
}
