import { createRoot } from "react-dom/client";
import { App } from "./App";
import { productionEditorAdapter } from "./editor/typie/productionAdapter";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Renderer root element is missing");
}

createRoot(root).render(
  <App
    api={window.madi}
    adapterFactory={productionEditorAdapter.factory}
    typieCommit={productionEditorAdapter.engineCommit}
    editorSchemaVersion={productionEditorAdapter.schemaVersion}
  />
);
