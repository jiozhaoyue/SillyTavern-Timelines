# Quality Guidelines

> Code quality and performance standards for SillyTavern-Timelines frontend.

---

## Overview

SillyTavern-Timelines is a performance-critical graph visualization plugin. It must smoothly render branching trees with thousands of nodes without blocking the UI thread or consuming excessive GPU resources.

---

## Forbidden Patterns

- **Direct In-place Chat Mutation**: Never alter or overwrite native SillyTavern/Luker chat `.jsonl` models for visualization purposes.
- **Dynamic JS Closures in Cytoscape Styles**: Avoid functions inside Cytoscape style declarations (e.g. `line-color: ele => ...`), which run per element on every render frame. Use static selectors with data mapping (`data(...)`) and classes instead.
- **Synchronous CPU-Heavy Graph Layouts on Main Thread**: Never run heavy Dagre layouts synchronously on graphs with > 100 nodes. Use `layoutService` (Web Worker) with fallback.

---

## Required Patterns

- **Pure Functional Graph Algorithms**: Keep algorithms (LCA, chain detection, LOD collapsing, lineage tracing) in pure modules (`src/api.js`, `src/lod-service.js`, `src/graph-builder.js`) decoupled from DOM and Cytoscape lifecycle so they can be 100% unit tested in Node.js.
- **Dual-Track LOD for Large Graphs**:
  1. *Topological LOD*: Collapse long non-branching sequences ($k \ge 10$) into synthetic cluster nodes with count badges (`+k 轮`).
  2. *Style LOD*: Dynamically simplify edges from `taxi` to `straight` when zooming out into macro view (`zoom < 0.35`).
- **Critical Node Protection Invariant**: In all collapsing, filtering, and pruning algorithms, the following nodes must NEVER be removed or collapsed:
  - Root node (`label="root"` / `isRoot: true`)
  - Branching nodes ($\text{outDegree} > 1$ or $\text{inDegree} > 1$)
  - Leaf nodes ($\text{outDegree} = 0$)
  - Bookmarked nodes (`isBookmark: true`)
  - Memory milestone nodes (`has_memory: true` / `hasMemory: true`)
  - Currently active message node

---

## Testing Requirements

- Every graph algorithm must have matching unit tests run via `node --test tests/*.test.mjs`.
- All tests must run in isolated Node.js environment without DOM dependencies.
- Visual and UI integrations must be verified end-to-end via Chrome DevTools Protocol against a live running instance.
