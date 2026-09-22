declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(filename: string, options?: any)
    exec(sql: string): void
    prepare(sql: string): {
      run(...params: any[]): { changes?: number; lastInsertRowid?: number }
      all(...params: any[]): any[]
      get(...params: any[]): any
      columns(): { name: string }[]
    }
  }
}
