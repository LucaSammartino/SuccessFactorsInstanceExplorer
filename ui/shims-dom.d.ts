/**
 * Loose DOM/UI5 typings for `main.ts` until components use stricter element types.
 */
export {};

declare global {
  interface HTMLElement {
    /** UI5 Button / SegmentedButtonItem */
    design?: string;
    opener?: HTMLElement;
    open?: boolean;
    disabled?: boolean;
  }

  interface EventTarget {
    value?: string;
    files?: FileList;
    closest?(selector: string): Element | null;
    dataset?: DOMStringMap;
  }

  interface Event {
    key?: string;
    dataTransfer?: DataTransfer;
    detail?: unknown;
  }
}
