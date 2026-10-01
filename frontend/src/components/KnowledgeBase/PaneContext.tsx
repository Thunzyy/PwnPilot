import { createContext, useContext } from "react";

const PaneContext = createContext<string>("default");

export const PaneProvider = PaneContext.Provider;

export function usePaneId(): string {
  return useContext(PaneContext);
}
