// Demo data for screenshots. Filled out in the design-review phase.

import { route } from "./mock.ts";

export function registerScenarios() {
  route(/^GET \/me$/, () => ({
    user: { id: 1, telegramName: "Ali", fullName: "Ali Valiyev", phone: "+998901234567", language: "uz", introSeen: ["worker", "admin"], writeAccess: true },
    needs: { consent: false, phone: false, name: false },
    role: "WORKER",
    isStaff: false,
    company: { id: 1, name: "Demo", currency: "UZS" },
    branches: [{ id: 1, name: "Chilonzor", timezone: "Asia/Tashkent" }],
    adminBranchIds: [],
    startParam: null,
    botUsername: "davomat_bot",
  }));
}
