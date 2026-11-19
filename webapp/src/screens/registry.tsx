// Every screen the stack can show. Admin screens load only when an admin opens them.

import { lazy, type ComponentType } from "react";
import WorkerHome from "./worker/Home.tsx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const screens: Record<string, ComponentType<any>> = {
  workerHome: WorkerHome,
  settings: lazy(() => import("./Settings.tsx")),
  scan: lazy(() => import("./worker/Scan.tsx")),
  month: lazy(() => import("./worker/Month.tsx")),
  history: lazy(() => import("./worker/History.tsx")),
  day: lazy(() => import("./DayView.tsx")),
  adminHome: lazy(() => import("./admin/AdminHome.tsx")),
  branchEditor: lazy(() => import("./admin/BranchEditor.tsx")),
  branch: lazy(() => import("./admin/BranchDetail.tsx")),
  admins: lazy(() => import("./admin/Admins.tsx")),
  schedule: lazy(() => import("./admin/Schedule.tsx")),
  amounts: lazy(() => import("./admin/Amounts.tsx")),
  workerReport: lazy(() => import("./admin/WorkerReport.tsx")),
  review: lazy(() => import("./admin/Review.tsx")),
  company: lazy(() => import("./admin/Company.tsx")),
};
