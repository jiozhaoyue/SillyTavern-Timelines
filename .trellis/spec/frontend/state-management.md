# State Management

> How state and inter-extension communication are managed in SillyTavern-Timelines.

---

## Overview

SillyTavern-Timelines operates as a client-side plugin within SillyTavern / Luker. It does not introduce proprietary backend storage; all branch graphs are derived deterministically from native SillyTavern chat files (`.jsonl`).

---

## State Categories

1. **Graph Model State (`cy`)**:
   - Holds Cytoscape.js instances, nodes, edges, positions, and element metadata (`node.data(...)`).
   - Exposed on `window.theCy` for debugging and external interop.
2. **Local Cache (`timelinesCache`)**:
   - Multi-tier cache (IndexedDB + in-memory LRU) storing parsed chat session message arrays and batch hashes.
3. **Inter-Extension Bus (`Luker.getContext().registerExtensionApi / getExtensionApi`)**:
   - Timelines registers its query APIs (`getTimelineTree`, `getBranchLineage`, `computeBranchLCA`, `getBranchNodes`, `onBranchSwitched`) via `registerTimelinesExtensionApi()`.
   - Interacts with `memory-graph` via `Luker.getContext().getExtensionApi('memory-graph')`.

---

## Inter-Extension Bus Guidelines

- **Deferred Registration**: Always register the extension API immediately on module execution, followed by deferred retries (`setTimeout(..., 200)` and `setTimeout(..., 1500)`) to ensure availability regardless of DOM ready or script loading order.
- **Graceful Degradation**: Always check if external APIs exist before invoking. Return sensible defaults (`{ events: [], count: 0 }`) if the peer extension is not installed or enabled.
- **Pure Functional Core**: Keep query and tree algorithms (such as LCA, lineage, branching) in pure helper functions (`src/api.js`) taking raw elements or data, decoupled from DOM and Cytoscape UI lifecycle.

---

## Common Mistakes

- Assuming peer extensions (e.g. `memory-graph`) are always present or initialized at the same time as `timelines`.
- Mutating message models or chat files directly instead of using SillyTavern native endpoints.
- Interleaving UI rendering logic with graph algorithmic traversals.
