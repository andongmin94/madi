import type { MadiEditorAdapterFactory } from "../MadiEditorAdapter";
import {
  TypieEditorAdapter,
  type TypieEnginePort
} from "./TypieEditorAdapter";

export type TypieRuntimeFactory = (
  mountElement: HTMLElement
) => Promise<TypieEnginePort>;

let registeredFactory: TypieRuntimeFactory | undefined;

/**
 * The real Typie WASM integration calls this during renderer bootstrap.
 * Tests inject a MadiEditorAdapterFactory directly and never register a fake
 * implementation into the production path.
 */
export function registerTypieRuntimeFactory(
  factory: TypieRuntimeFactory
): () => void {
  if (registeredFactory) {
    throw new Error("A Typie runtime factory is already registered");
  }
  registeredFactory = factory;
  return () => {
    if (registeredFactory === factory) {
      registeredFactory = undefined;
    }
  };
}

export const createRegisteredTypieEditorAdapter: MadiEditorAdapterFactory =
  async (mountElement) => {
    if (!registeredFactory) {
      throw new Error(
        "Typie WASM runtime is not registered. This shell does not substitute a fake editor."
      );
    }
    const port = await registeredFactory(mountElement);
    return new TypieEditorAdapter(port, mountElement);
  };
