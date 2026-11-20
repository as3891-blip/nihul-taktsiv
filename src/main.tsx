import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import BudgetApp from "./BudgetApp";

// Entry point: mounts the single-file app into <div id="root">.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BudgetApp />
  </StrictMode>,
);
