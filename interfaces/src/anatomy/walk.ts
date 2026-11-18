/**
 * The nodes and the holes of an anatomy, wherever they stand in it.
 *
 * A child of a node is one of three things: a node, a hole, or a choice
 * between nodes, and a node's tag is one tag or a list. Whoever asks a
 * question about the whole tree, as which sources it names or what stands
 * around a hole, asks here and need not know that. The renderer and the
 * rules in `check-anatomy.ts` still go down the tree themselves, because
 * they do something at every level: a new kind of child is a change here
 * and in those.
 *
 * Not part of the package's API: `index.ts` does not export it.
 */

import type {
  Anatomy,
  AnatomyChild,
  AnatomyChoice,
  AnatomyHole,
  AnatomyNode,
} from "../vocabulary/types.js"

/** A node where it stands in the tree. */
export type NodePlace = {
  node: AnatomyNode
  /** The choice the node is an alternative of, and which one. */
  choice?: AnatomyChoice
  alternative?: string
  /** The node around it. Left out at the root. */
  parent?: NodePlace
}

/** A hole among the children of a node, where it stands in the tree. */
export type HolePlace = {
  hole: AnatomyHole
  /** The node around it. Left out when the hole is the root. */
  parent?: NodePlace
}

export const isHole = (child: AnatomyChild): child is AnatomyHole =>
  "hole" in child
export const isChoice = (child: AnatomyChild): child is AnatomyChoice =>
  "oneOf" in child

/** The tags a node can be, the first being the one to write. */
export const tagsOf = (node: AnatomyNode): readonly string[] =>
  typeof node.tag === "string" ? [node.tag] : node.tag

function* places(
  children: readonly AnatomyChild[],
  parent: NodePlace | undefined,
): Generator<NodePlace | HolePlace> {
  for (const child of children) {
    if (isHole(child)) {
      yield { hole: child, parent }
      continue
    }
    const nodes: NodePlace[] = isChoice(child)
      ? Object.entries(child.oneOf).map(([alternative, node]) => ({
          node,
          choice: child,
          alternative,
          parent,
        }))
      : [{ node: child, parent }]
    for (const place of nodes) {
      yield place
      yield* places(place.node.children ?? [], place)
    }
  }
}

/**
 * Every node in the anatomy, every alternative of every choice included: a
 * node before the ones inside it, and children in the order they are
 * written.
 */
export function* nodesOf(
  anatomy: Pick<Anatomy, "nodes">,
): Generator<NodePlace> {
  for (const place of places(anatomy.nodes, undefined))
    if ("node" in place) yield place
}

/**
 * Every hole among the children of the nodes, once for each place it
 * stands. A hole in an attribute is on its node, in `attributes`.
 */
export function* holesOf(
  anatomy: Pick<Anatomy, "nodes">,
): Generator<HolePlace> {
  for (const place of places(anatomy.nodes, undefined))
    if ("hole" in place) yield place
}

/** The places from the root to a node, the node itself last. */
export function pathTo(place: NodePlace): NodePlace[] {
  const path: NodePlace[] = []
  for (let at: NodePlace | undefined = place; at; at = at.parent)
    path.unshift(at)
  return path
}

/** The nodes around a place, outermost first. */
export function aroundOf(place: NodePlace | HolePlace): AnatomyNode[] {
  return place.parent ? pathTo(place.parent).map((at) => at.node) : []
}
