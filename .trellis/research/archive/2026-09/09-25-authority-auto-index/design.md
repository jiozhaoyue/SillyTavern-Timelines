# 实施设计：自动增量索引

## 挂点与数据流

```
onTimelineButtonClick
  └─ await updateTimelineDataIfNeeded(...)  → true（数据确有更新）
      └─ 收尾（progressState.done() 后）fire-and-forget maybeAutoSemanticIndex()
          ├─ settings.semanticAutoIndex 开？ Authority ready？ elements 非空？
          ├─ autoIndexThrottle.attempt() === 'run'？
          └─ triggerSemanticBuild(false, { silent: true })
              └─ 增量 diff → 通常个位数 upsert → settle(ok)
```

## 关键点

1. **节流状态机**（createAutoIndexThrottle）：running 与 cooldownUntil 单例字段；attempt 在 busy 或冷却期返回 skip；settle(false) 设 `cooldownUntil = now + 60s`。纯函数可注入 now（测试时间推进）。
2. **静默**：triggerSemanticBuild(forceRebuild, { silent = false })——silent 时跳过 toastr.info/success/error，失败走 console.warn + `#tl_semantic_status` 文本。
3. **失败冷却语义**：embedding 通道不可用的宿主（如 Luker）自动路径每 60s 至多失败一次，不风暴；用户手动按钮不受限。
