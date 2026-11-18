/**
 * `atOnce()` and `turn()`, the way `check-cli.ts` runs its blocks a few at a
 * time and files each failure under the block that made it. Every ordering
 * here is set by promises the test resolves by hand, so no test waits on the
 * clock.
 *
 * Run with: bun test ./scripts/, or as part of `bun run build`.
 */

import { expect, test } from "bun:test"
import { atOnce, turn } from "./at-once.js"

/** A promise that is settled by calling `open`, when the test says so. */
const gate = () => {
  let open: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

/** Lets everything that can run without a gate run, and nothing more. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

test("the results come back in written order when the tasks finish in the reverse order", async () => {
  const gates = [gate(), gate(), gate()]
  const result = atOnce(
    3,
    gates.map((g, i) => async () => {
      await g.promise
      return `task ${i}`
    }),
  )
  gates[2]?.open()
  await settle()
  gates[1]?.open()
  await settle()
  gates[0]?.open()
  expect(await result).toEqual(["task 0", "task 1", "task 2"])
})

test("no more than the limit run at once, and the limit is reached", async () => {
  let running = 0
  let most = 0
  const task = (n: number) => async () => {
    running += 1
    most = Math.max(most, running)
    await settle()
    running -= 1
    return n
  }
  const result = await atOnce(2, [0, 1, 2, 3, 4].map(task))
  expect(result).toEqual([0, 1, 2, 3, 4])
  expect(most).toBe(2)
})

test("a task starts as soon as one finishes, not when a whole batch has", async () => {
  const gates = [gate(), gate(), gate()]
  const started: number[] = []
  const result = atOnce(
    2,
    gates.map((g, i) => async () => {
      started.push(i)
      await g.promise
    }),
  )
  await settle()
  expect(started).toEqual([0, 1])
  gates[1]?.open()
  await settle()
  expect(started).toEqual([0, 1, 2])
  gates[0]?.open()
  gates[2]?.open()
  await result
})

test("with a limit of one the tasks run one after another in written order", async () => {
  const events: string[] = []
  const task = (n: number) => async () => {
    events.push(`start ${n}`)
    await settle()
    events.push(`end ${n}`)
  }
  await atOnce(1, [0, 1, 2].map(task))
  expect(events).toEqual([
    "start 0",
    "end 0",
    "start 1",
    "end 1",
    "start 2",
    "end 2",
  ])
})

test("a limit larger than the number of tasks runs them all at once, and no tasks give no results", async () => {
  const gates = [gate(), gate(), gate()]
  let started = 0
  const result = atOnce(
    10,
    gates.map((g) => async () => {
      started += 1
      await g.promise
    }),
  )
  await settle()
  expect(started).toBe(3)
  for (const g of gates) g.open()
  await result
  expect(await atOnce(4, [])).toEqual([])
})

test("every task is run when an early one throws, and the call then fails with its error", async () => {
  const ran: number[] = []
  const task = (n: number) => async () => {
    ran.push(n)
    await settle()
    if (n === 0) throw new Error("first failed")
    return n
  }
  await expect(atOnce(1, [0, 1, 2, 3].map(task))).rejects.toThrow(
    "first failed",
  )
  expect(ran).toEqual([0, 1, 2, 3])
})

test("when two tasks throw, the one written first is the error, even if the later threw first", async () => {
  const early = gate()
  const late = gate()
  const result = atOnce(2, [
    async () => {
      await early.promise
      throw new Error("written first")
    },
    async () => {
      await late.promise
      throw new Error("written second")
    },
  ])
  const settled = result.catch((error: Error) => error.message)
  late.open()
  await settle()
  early.open()
  expect(await settled).toBe("written first")
})

test("turn is undefined outside a task, also after atOnce has finished", async () => {
  expect(turn()).toBeUndefined()
  await atOnce(2, [async () => 1, async () => 2])
  expect(turn()).toBeUndefined()
})

test("turn is the number of the task, also after an await and inside a helper, while the tasks interleave", async () => {
  const gates = [gate(), gate(), gate()]
  const seen: (number | undefined)[][] = [[], [], []]
  const helper = async (n: number) => {
    await settle()
    seen[n]?.push(turn())
  }
  const result = atOnce(
    3,
    gates.map((g, n) => async () => {
      await g.promise
      seen[n]?.push(turn())
      await helper(n)
      return turn()
    }),
  )
  gates[1]?.open()
  await settle()
  gates[2]?.open()
  await settle()
  gates[0]?.open()
  expect(await result).toEqual([0, 1, 2])
  expect(seen).toEqual([
    [0, 0],
    [1, 1],
    [2, 2],
  ])
})

test("a task that reads turn before its first await sees its own number", async () => {
  const result = await atOnce(2, [
    async () => turn(),
    async () => turn(),
    async () => turn(),
  ])
  expect(result).toEqual([0, 1, 2])
})

test("a limit below one is refused, since no task would ever run", async () => {
  const task = async () => 1
  for (const limit of [0, -1, Number.NaN])
    await expect(atOnce(limit, [task])).rejects.toThrow(
      "atOnce: the limit must be at least 1",
    )
})
