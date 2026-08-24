"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";

const FeedbackContext = createContext(null);

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const lastFocus = useRef(null);

  const dismiss = useCallback((id) => setToasts((items) => items.filter((item) => item.id !== id)), []);
  const notify = useCallback((message, options = {}) => {
    const id = `${Date.now()}-${Math.random()}`;
    const item = { id, message, title: options.title || (options.tone === "success" ? "Done" : options.tone === "warning" ? "Please check" : "Something needs attention"), tone: options.tone || "error" };
    setToasts((items) => [...items.slice(-3), item]);
    window.setTimeout(() => dismiss(id), options.duration || 5200);
    return id;
  }, [dismiss]);

  const confirm = useCallback((options) => new Promise((resolve) => {
    lastFocus.current = document.activeElement;
    setDialog({
      title: typeof options === "string" ? "Are you sure?" : options.title || "Are you sure?",
      message: typeof options === "string" ? options : options.message,
      confirmLabel: typeof options === "string" ? "Continue" : options.confirmLabel || "Continue",
      cancelLabel: typeof options === "string" ? "Cancel" : options.cancelLabel || "Cancel",
      tone: typeof options === "string" ? "danger" : options.tone || "danger",
      resolve,
    });
  }), []);

  const finishDialog = useCallback((value) => {
    setDialog((current) => { current?.resolve(value); return null; });
    window.setTimeout(() => lastFocus.current?.focus?.(), 0);
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (event) => { if (event.key === "Escape") finishDialog(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog, finishDialog]);

  const value = useMemo(() => ({ notify, confirm }), [notify, confirm]);
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="feedback-layer" aria-live="polite">
        <div className="toast-stack">{toasts.map((toast) => <div className={`toast ${toast.tone}`} key={toast.id} role="status"><span className="toast-icon"><Icon name={toast.tone === "success" ? "check" : toast.tone === "warning" ? "warning" : "info"} size={16}/></span><span className="toast-copy"><b>{toast.title}</b><span>{toast.message}</span></span><button className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification"><Icon name="x" size={15}/></button></div>)}</div>
        {dialog ? <div className="feedback-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) finishDialog(false); }}><div className="feedback-dialog" role="alertdialog" aria-modal="true" aria-labelledby="feedback-dialog-title" aria-describedby="feedback-dialog-copy"><span className="feedback-dialog-icon"><Icon name={dialog.tone === "danger" ? "warning" : "info"} size={20}/></span><h2 id="feedback-dialog-title">{dialog.title}</h2><p id="feedback-dialog-copy">{dialog.message}</p><div className="feedback-dialog-actions"><button className="public-link-button" onClick={() => finishDialog(false)} autoFocus>{dialog.cancelLabel}</button><button className="public-button" onClick={() => finishDialog(true)}>{dialog.confirmLabel}</button></div></div></div> : null}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback must be used inside FeedbackProvider");
  return context;
}
