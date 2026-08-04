import { forwardRef } from "react";
import { ReaderLabWorkspace } from "./readerLab/ReaderLabWorkspace";
import type {
  ReaderLabModeHandle,
  ReaderLabModeProps
} from "./readerLab/types";
import "./readerLab/readerLab.css";

export type { ReaderLabModeHandle, ReaderLabModeProps } from "./readerLab/types";

export const ReaderLabMode = forwardRef<
  ReaderLabModeHandle,
  ReaderLabModeProps
>(function ReaderLabMode(props, ref) {
  return <ReaderLabWorkspace {...props} ref={ref} />;
});
