import { MADI_SCENE_BREAK_SEMANTIC_ID } from "../MadiEditorAdapter";

/**
 * This mapping is an adapter invariant for the pinned Typie commit. A generic
 * horizontal-rule feature must not reuse it without adding durable madi
 * metadata that can distinguish decoration from a manuscript scene boundary.
 */
export const TYPIE_SCENE_BREAK_MAPPING = {
  semanticId: MADI_SCENE_BREAK_SEMANTIC_ID,
  nodeType: "horizontal_rule",
  variant: "three_diamonds"
} as const;
