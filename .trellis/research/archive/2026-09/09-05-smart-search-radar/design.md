# 智能全景雷达与多维复合检索器 Design

## 1. 算法与逻辑设计
`filterOptions`:
```js
{
  query: string,            // 搜索文本或 /regex/i
  speakerFilter: 'all' | 'user' | 'character',
  onlyBookmarks: boolean,
  onlyTagged: boolean,
  onlySwipes: boolean,
  minFloor: number | null,
  maxFloor: number | null,
}
```

`parseSearchQuery(queryString)`:
- 检测是否为正则 `/pattern/flags`：若是且有效，返回 `{ isRegex: true, regex: RegExp }`。
- 否则返回 `{ isRegex: false, fragments: string[] }` (小写、去除首尾空格)。

`matchesNode(nodeData, filterOptions, parsedQuery)`:
- 检查 `speakerFilter`：
  - `'user'`: 要求 `nodeData.is_user === true`。
  - `'character'`: 要求 `nodeData.is_user === false`。
- 检查 `onlyBookmarks`:
  - 要求 `nodeData.isBookmark || nodeData.bookmark || nodeData.extra?.bookmark === true`。
- 检查 `onlyTagged`:
  - 要求 `extractNodeTags(nodeData).length > 0`。
- 检查 `onlySwipes`:
  - 要求 `Array.isArray(nodeData.swipes) && nodeData.swipes.length > 1`。
- 检查 `minFloor` 与 `maxFloor`:
  - 要求 `floor >= minFloor && floor <= maxFloor`。
- 检查 `query`:
  - 若 regex：`regex.test(text)` 或 `regex.test(tags)`
  - 若 fragments：所有 fragment 必须同时命中（`AND` 逻辑），或单 fragment 命中。

## 2. 界面与交互设计
1. 搜索框右侧伴随式状态指示器：
   - `<div class="radar-stepper">`
     - `<span class="radar-badge">0/0</span>`
     - `<button class="radar-btn radar-prev"><i class="fa-solid fa-chevron-up"></i></button>`
     - `<button class="radar-btn radar-next"><i class="fa-solid fa-chevron-down"></i></button>`
     - `<button class="radar-btn radar-filter-toggle"><i class="fa-solid fa-sliders"></i></button>`
2. 展开式筛选面板 `.radar-filter-popover`:
   - 角色单选 (全部 / User / Character)
   - 快速复选 (仅书签 / 仅标签 / 仅重试 Swipes)
   - 楼层范围输入 (从 Min 到 Max)
3. 键盘事件监听：
   - `Enter`: 聚焦下一个匹配节点并脉冲
   - `Shift+Enter`: 聚焦上一个匹配节点并脉冲
   - `Escape`: 清除筛选，恢复全图所有元素样式
