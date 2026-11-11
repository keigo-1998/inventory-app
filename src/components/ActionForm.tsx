"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/lib/actions";

type Props = {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel: string;
  resetOnSuccess?: boolean;
  className?: string;
};

export function ActionForm({ action, children, submitLabel, resetOnSuccess, className }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.message) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className ?? "form"}
      onSubmit={(e) => {
        // React 19 の自動フォームリセットを避け、エラー時に入力内容を保持する
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      {children}
      {state.error && <p className="alert alert-error">{state.error}</p>}
      {state.message && !state.error && <p className="alert alert-ok">{state.message}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "処理中…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
