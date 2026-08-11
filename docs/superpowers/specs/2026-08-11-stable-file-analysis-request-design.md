# 稳定版经营资料分析请求设计

日期：2026-08-11
状态：待用户书面确认

## 1. 背景

当前 PR #17 已建立经营报表主链路：

```text
报表图片
  -> 百度千帆 deepseek-ocr
  -> DeepSeek V4 结构化
  -> 确定性程序复算
  -> 老板确认
  -> DeepSeek 经营诊断与复核
```

业务判断链路本身继续保留。本次只处理移动端上传分析过程中的连接稳定性。

现有前端使用 `fetch('/api/analyze-file?stream=1')` + `ReadableStream.getReader()` 手工解析 SSE；服务端使用 `res.write()` 持续推送进度。iPhone Safari 实测出现过在 8% 阶段直接报 `Load failed`，说明长连接层存在实际不稳定现象。当前证据不足以断言 SSE 是唯一根因，因此本次改造目标是减少传输复杂度并提高可诊断性，而不是把未经证明的假设写成结论。

## 2. 本阶段目标

第一阶段采用简单稳定方案：

```text
图片优化
  -> Base64
  -> 普通 POST /api/analyze-file
  -> 服务端完整执行 OCR / 结构化 / 程序检查
  -> 一次性 JSON 返回
  -> 前端展示检查结果
```

本阶段不要求网页切后台、锁屏或关闭后任务继续执行。用户需要保持当前页面打开。

后续如果真实使用证明需要后台持续执行，再单独升级为 taskId + 状态存储 + 轮询的后台任务架构。

## 3. 保留范围

以下逻辑不得因本次改造改变：

- 千帆 `deepseek-ocr` 仍负责云端原图识别。
- `DEEPSEEK_API_KEY` 对应的 DeepSeek 仍负责 OCR 文本结构化、经营诊断和第二次复核。
- 本地 OCR 仍只作为降级兜底。
- 确定性程序仍是唯一可以生成可证明 `correctedValue` 的模块。
- `cloud_ocr_deepseek`、`local_ocr_degraded`、`ocr_unavailable` 三种识别状态保持不变。
- 参考报表 9 项预期问题及其真实性约束保持不变。
- OpenAI 不重新进入运行时主链路。

## 4. 前端设计

### 4.1 请求方式

删除图片分析对 SSE 的强依赖。图片和其他经营资料统一通过普通 JSON POST：

```text
POST /api/analyze-file
Content-Type: application/json
```

请求体保持现有文件结构：

```json
{
  "file": {
    "name": "经营报表.png",
    "contentBase64": "..."
  }
}
```

### 4.2 状态展示

不再向老板展示 8%、38%、58%、93% 这类看似精确但实际依赖服务端长连接的百分比。

前端只展示简单阶段状态：

1. `正在优化图片`
2. `正在上传资料`
3. `正在分析报表，请保持页面打开`
4. `报表检查完成，等待确认`
5. 失败时显示明确错误类型

前端可以保留已用时秒数，但不得把本地计时伪装成服务端真实处理进度。

### 4.3 取消和重试

- 当前请求继续使用 `AbortController`，用户可以主动取消。
- 失败后保留“重新分析”按钮。
- 不再基于 SSE 的读取状态做断流恢复。
- 第一阶段不自动承诺切后台后恢复任务。

## 5. 错误分类

前端必须区分至少三类失败。

### A. 浏览器传输失败

例如 Safari 抛出 `TypeError: Load failed`、网络断开、请求未收到 HTTP 响应。

用户文案：

> 分析请求没有正常连接到服务器。请保持页面打开并重试。

内部安全码建议：

`FILE_TRANSPORT_FAILED`

### B. 服务端 HTTP 错误

如果 `/api/analyze-file` 返回非 2xx：

- 429：请求过于频繁
- 413：文件过大
- 415：文件类型不支持
- 422：文件损坏或无法解析
- 5xx：分析服务异常

如果服务端返回 `requestId`，前端必须展示该编号，方便后续追踪。

### C. 上游 OCR / DeepSeek 降级

这类错误仍由现有 `reportReview.summary.failureCode` 表达，例如：

- `OCR_KEY_MISSING`
- `OCR_HTTP_401`
- `OCR_HTTP_403`
- `OCR_HTTP_429`
- `OCR_TIMEOUT`
- `OCR_NETWORK_ERROR`
- `REPORT_STRUCTURE_FAILED`

只显示安全错误码，不显示 API Key、Authorization Header 或第三方原始响应正文。

## 6. 服务端设计

`api/analyze-file.js` 保留非流式 JSON 返回路径，并将其作为第一阶段默认主路径。

服务端仍按顺序执行：

```text
文件解析
  -> 若为图片：千帆 OCR
  -> DeepSeek 结构化
  -> 程序复算
  -> buildPayload
  -> HTTP 200 JSON
```

本次不改变 OCR 和 DeepSeek 的业务超时策略，除非后续测试证明当前超时本身不合理。

现有 SSE 辅助函数可以先保留一版用于兼容测试，但前端不再调用 `?stream=1`。确认稳定后，再在单独清理提交中删除未使用的 SSE 代码，避免一次改动过大。

## 7. 为什么不直接做后台任务

真正的后台任务需要至少新增：

- taskId
- 状态持久化
- 结果存储
- 轮询 API
- 任务过期策略
- 并发与重复任务处理
- Vercel 执行时长与持久化边界设计

这些会显著扩大当前问题范围。当前首要目标是先证明“页面保持打开时，报表诊断闭环可以稳定完成”。在这个目标未通过真实 Preview 验收前，不引入数据库或队列。

## 8. 测试策略

必须按 TDD 实施。

### 前端测试

新增或修改测试，要求：

1. 文件分析请求不再包含 `?stream=1`。
2. 不再依赖 `response.body.getReader()` 才能获得图片分析结果。
3. 浏览器 `fetch` 直接失败时显示稳定的传输层错误文案。
4. 非 2xx 响应继续读取安全 `error` 和 `requestId`。
5. 用户主动取消仍识别为取消，不误报为服务器故障。
6. 页面状态文案明确提醒分析期间保持页面打开。

### API 测试

保持并验证：

1. 普通 POST 图片请求可以完成 `cloud OCR -> structuring -> report-check` 业务链路。
2. 千帆失败时仍返回降级结果，而不是因为没有 SSE 就丢失 `failureCode`。
3. DeepSeek 结构化失败仍返回 `REPORT_STRUCTURE_FAILED`。
4. 所有错误响应继续带安全 `requestId`。
5. API Key 和第三方错误正文不进入返回值或日志。

### 回归测试

- 全量 `npm test` 通过。
- production build 通过。
- 现有参考报表 9 项规则测试全部通过。

## 9. Preview 真实验收

代码和 CI 通过后，必须在 `zhenduan-v03-preview` 使用同一张参考报表 `IMG_0511.png` 做真实上传。

第一阶段验收标准：

1. 页面保持前台时，不再出现旧 SSE 连接导致的 `Load failed` 路径。
2. 普通 POST 能收到服务器 HTTP 结果。
3. 如果千帆失败，能看到准确安全错误码，而不是泛化提示。
4. 如果千帆成功，结果为 `cloud_ocr_deepseek` 且 `completeReview=true`。
5. 对照 9 项参考问题逐条验证实际输出。
6. 未完成真实同图测试前，不合并 PR #17。

如果普通 POST 仍出现浏览器级 `Load failed`，则说明 SSE 不是根因，需要基于新的证据继续调查网络、Vercel Function 执行限制或请求体问题，不能继续猜测。

## 10. 明确不做

本阶段不做：

- 后台任务队列
- 数据库任务持久化
- 页面关闭后继续执行
- WebSocket
- 为进度条保留复杂长连接
- 更换千帆 OCR Provider
- 更换 DeepSeek Provider
- 修改 9 项经营报表规则
- 引入新的 AI 模型作为兜底

## 11. 后续升级条件

只有第一阶段真实稳定后，并且实际用户明确需要“锁屏/切后台后仍继续分析”，才进入第二阶段：

```text
POST /api/analysis-jobs -> taskId
GET /api/analysis-jobs/:id -> status/result
持久化任务状态
前端轮询
```

第二阶段单独设计、单独测试，不和本阶段混在一个 PR 改造中。
