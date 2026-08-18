import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LlmAssistantOverlay } from "./components/llm/LlmAssistantOverlay";
import { LlmProviderDiagnostics } from "./components/llm/LlmProviderDiagnostics";
import { LlmSelectionRewriteOverlay } from "./components/llm/LlmSelectionRewriteOverlay";
import { productionEditorAdapter } from "./editor/typie/productionAdapter";
import {
  createLlmTrackedEditorFactory,
  LlmEditorAccess
} from "./llm/editorAccess";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Renderer root element is missing");
}

const llmEditorAccess = new LlmEditorAccess();
const editorFactory = createLlmTrackedEditorFactory(
  productionEditorAdapter.factory,
  llmEditorAccess
);
const createLlmId = () => crypto.randomUUID();
const currentDate = () => new Date();

createRoot(root).render(
  <>
    <App
      api={window.madi}
      adapterFactory={editorFactory}
      typieCommit={productionEditorAdapter.engineCommit}
      editorSchemaVersion={productionEditorAdapter.schemaVersion}
    />
    <LlmSelectionRewriteOverlay
      api={window.madiLlm}
      editorAccess={llmEditorAccess}
      createId={createLlmId}
      now={currentDate}
    />
    <LlmProviderDiagnostics
      api={window.madiLlm}
      createId={createLlmId}
    />
    <LlmAssistantOverlay
      api={window.madiLlm}
      editorAccess={llmEditorAccess}
      createId={createLlmId}
      now={currentDate}
    />
  </>
);
