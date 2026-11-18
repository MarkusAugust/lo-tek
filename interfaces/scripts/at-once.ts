/**
 * Running a script's independent blocks a few at a time. `check-cli.ts`
 * spends its time waiting on the processes it starts, one after another, and
 * its blocks share nothing: each has its own folder.
 */

import { AsyncLocalStorage } from "node:async_hooks"

const turns = new AsyncLocalStorage<number>()

/**
 * Runs the tasks with at most `limit` going at the same time, and gives what
 * each one returned in the order the tasks were written, not the order they
 * finished. Every task is run, also after one has thrown; when all are done,
 * the error of the first task in written order that threw is thrown.
 */
export async function atOnce<T>(
  limit: number,
  tasks: (() => Promise<T>)[],
): Promise<T[]> {
  if (!(limit >= 1))
    throw new Error(`atOnce: the limit must be at least 1, and is ${limit}.`)
  const results: T[] = []
  const errors = new Map<number, unknown>()
  let next = 0

  // One worker takes the next task not yet taken until none are left, so a
  // new task starts the moment another finishes.
  const worker = async () => {
    while (next < tasks.length) {
      const number = next++
      try {
        results[number] = await turns.run(number, () => tasks[number]())
      } catch (error) {
        errors.set(number, error)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  )

  if (errors.size > 0) throw errors.get(Math.min(...errors.keys()))
  return results
}

/**
 * The number of the task the caller runs inside, counted from 0 in written
 * order, also after an `await` inside the task and in functions the task
 * calls. `undefined` outside a task.
 */
export function turn(): number | undefined {
  return turns.getStore()
}
