// Every screen the stack can show. Admin screens load only when an admin opens them.

import { lazy, type ComponentType } from "react";
import WorkerHome from "./worker/Home.tsx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const screens: Record<string, ComponentType<any>> = {
  workerHome: WorkerHome,
  settings: lazy(() => import("./Settings.tsx")),
  adminHome: lazy(() => import("./admin/AdminHome.tsx")),
  branchEditor: lazy(() => import("./admin/BranchEditor.tsx")),
  branch: lazy(() => import("./admin/BranchDetail.tsx")),
  admins: lazy(() => import("./admin/Admins.tsx")),
  schedule: lazy(() => import("./Soon.tsx")),
  amounts: lazy(() => import("./Soon.tsx")),
  workerReport: lazy(() => import("./Soon.tsx")),
  company: lazy(() => import("./Soon.tsx")),
};
