declare module '@novnc/novnc' {
  interface RFBOptions {
    wsProtocols?: string[];
    credentials?: { password?: string };
    shared?: boolean;
    repeaterID?: string;
    wsURL?: string;
  }

  interface RFBEventDetail {
    clean: boolean;
    name?: string;
  }

  class RFB {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    disconnect(): void;
    sendCredentials(credentials: { password?: string }): void;
    sendKey(keysym: number, code: string, down?: boolean): void;
    sendCtrlAltDel(): void;
    focus(): void;
    blur(): void;
    machineShutdown(): void;
    machineReboot(): void;
    machineReset(): void;
    clipboardPasteFrom(text: string): void;

    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    viewOnly: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    focusOnClick: boolean;

    addEventListener(event: string, handler: (e: { detail: RFBEventDetail }) => void): void;
    removeEventListener(event: string, handler: (e: { detail: RFBEventDetail }) => void): void;
  }

  export default RFB;
}
