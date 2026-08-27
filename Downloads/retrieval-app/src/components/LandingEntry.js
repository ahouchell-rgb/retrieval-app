"use client";
import { Landing } from "./Landing";

export function LandingEntry() {
  const openWorkspace = () => { window.location.assign("/app?login=1"); };
  return <Landing onLogin={openWorkspace} />;
}
