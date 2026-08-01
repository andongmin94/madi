import buildInfo from "@madi/typie-runtime/build-info";
import type { MadiEditorAdapterFactory } from "../MadiEditorAdapter";
import { createTypieEnginePort } from "./createTypieEnginePort";
import {
  createRegisteredTypieEditorAdapter,
  registerTypieRuntimeFactory
} from "./runtimeRegistry";

registerTypieRuntimeFactory(() => createTypieEnginePort());

/**
 * The renderer composition root receives only madi-owned adapter metadata.
 * Generated Typie bindings and build-info types remain in this directory.
 */
export const productionEditorAdapter: {
  readonly factory: MadiEditorAdapterFactory;
  readonly engineCommit: string;
  readonly schemaVersion: number;
} = {
  factory: createRegisteredTypieEditorAdapter,
  engineCommit: buildInfo.typieCommit,
  schemaVersion: 1
};
