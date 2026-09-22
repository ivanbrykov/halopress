declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}

declare module '*.gmdl' {
  const data: ArrayBuffer
  export default data
}

declare module 'cloudflare:workers' {
  export class WorkerEntrypoint {
    protected env: unknown
    protected ctx: unknown
  }

  export class DurableObject {
    protected ctx: {
      storage: unknown
      waitUntil(promise: Promise<unknown>): void
    }

    protected env: unknown
    constructor(ctx: unknown, env: unknown)
  }
}
