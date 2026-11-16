export {}

declare global {
  interface Window {
    cyberGoose?: {
      platform: string
      openExternal: (url: string) => Promise<void>
    }
  }
}
