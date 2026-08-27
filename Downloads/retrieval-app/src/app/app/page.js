import { WorkspaceApp } from "../../components/WorkspaceApp";

export const metadata = {
  title: "Workspace",
  description: "Feynman Education teacher and pupil workspace.",
  robots: { index: false, follow: false },
};

export default function WorkspacePage() {
  return <WorkspaceApp />;
}
