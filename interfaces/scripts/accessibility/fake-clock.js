/*
 * A fake clock for the contracts with `clock`, in a browser without one of
 * its own: safaridriver has nothing like Playwright's page.clock. Loaded
 * before anything else on the page. Date, setTimeout and setInterval run on a
 * time that follows the real one, and `__lotekClock.runFor(ms)` moves it
 * forward, firing what falls due in order, the way page.clock.runFor() does.
 * requestAnimationFrame stays real: the barrier waits for frames.
 */
;(() => {
  const RealDate = Date
  const realNow = () => RealDate.now()
  const realSetTimeout = window.setTimeout.bind(window)
  const realClearTimeout = window.clearTimeout.bind(window)
  let offset = 0
  const now = () => realNow() + offset
  /** id → { at, fn, args, every, real } */
  const timers = new Map()
  let nextId = 1

  function schedule(id) {
    const timer = timers.get(id)
    timer.real = realSetTimeout(() => fire(id), Math.max(0, timer.at - now()))
  }
  function fire(id) {
    const timer = timers.get(id)
    if (!timer) return
    realClearTimeout(timer.real)
    if (timer.every === undefined) timers.delete(id)
    else {
      timer.at += timer.every
      schedule(id)
    }
    timer.fn(...timer.args)
  }
  function add(fn, delay, args, every) {
    const id = nextId++
    // A string to evaluate is left out: nothing in the package passes one.
    if (typeof fn !== "function")
      throw new TypeError("the fake clock takes a function, not a string")
    timers.set(id, {
      at: now() + Math.max(0, Number(delay) || 0),
      fn,
      args,
      every,
    })
    schedule(id)
    return id
  }
  function clear(id) {
    const timer = timers.get(id)
    if (!timer) return
    realClearTimeout(timer.real)
    timers.delete(id)
  }

  window.setTimeout = (fn, delay, ...args) => add(fn, delay, args)
  window.setInterval = (fn, delay, ...args) =>
    add(fn, delay, args, Math.max(1, Number(delay) || 0))
  window.clearTimeout = clear
  window.clearInterval = clear

  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now())
      else super(...args)
    }
    static now() {
      return now()
    }
  }
  window.Date = FakeDate

  window.__lotekClock = {
    runFor(ms) {
      const end = now() + ms
      for (;;) {
        let soonest
        for (const [id, timer] of timers)
          if (
            timer.at <= end &&
            (soonest === undefined || timer.at < timers.get(soonest).at)
          )
            soonest = id
        if (soonest === undefined) break
        offset += Math.max(0, timers.get(soonest).at - now())
        fire(soonest)
      }
      offset += Math.max(0, end - now())
      // The real timeouts were set for the old time.
      for (const id of timers.keys()) {
        realClearTimeout(timers.get(id).real)
        schedule(id)
      }
    },
  }
})()
