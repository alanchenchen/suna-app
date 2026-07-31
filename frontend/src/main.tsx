import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <main>Suna App development shell</main>;
}

const root = document.getElementById("root");

if (root === null) {
  throw new Error("missing root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
