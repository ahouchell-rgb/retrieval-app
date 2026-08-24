"use client";
import { FeedbackProvider } from "./Feedback";

export function ClientProviders({ children }) {
  return <FeedbackProvider>{children}</FeedbackProvider>;
}
