declare module "cross-spawn" {
  import { type ChildProcess, type SpawnOptions } from "node:child_process"
  function spawn(command: string, args: readonly string[], options?: SpawnOptions): ChildProcess
  export default spawn
}