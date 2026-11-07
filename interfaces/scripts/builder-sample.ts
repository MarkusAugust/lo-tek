/**
 * Options every builder function accepts: the ones some of them require.
 * `lt.tabs()` throws without `keys`, `lt.sessionTimeout()` without
 * `titleId`. `page-setup.ts` and `check-server-import.ts` call every builder
 * function with them.
 */
export const SAMPLE = {
  id: "x",
  titleId: "t",
  count: 1,
  keys: ["a"],
  label: "L",
}
