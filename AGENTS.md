<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# 仓库 Git 政策（用户指令，必须遵守）

**每次提交必须推送到远程，禁止只做本地提交。**

- 任何一批 `git commit` 完成后，必须立即执行 `git push origin <当前分支>`（首次推送到新分支用 `git push -u origin <分支>`）。
- 工作提交、归档提交、日志提交全部适用；「不推送」的例外仅当用户在同一轮明确说「先不要推」。
- 推送目标固定为 `origin`（jiozhaoyue fork），绝不推送到 `upstream`。
