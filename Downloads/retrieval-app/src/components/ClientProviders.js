"use client";
import { useEffect } from "react";
import { FeedbackProvider } from "./Feedback";

export function ClientProviders({ children }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return <FeedbackProvider>{children}</FeedbackProvider>;
}
