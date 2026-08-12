# PR17 可信证据与部署链路修复设计

日期：2026-08-12
状态：已确认设计，待书面规格复核

## 1. 目标

在不重做 PR17 OCR 架构的前提下，修复已经复现的可信度与部署阻断问题：

1. 浏览器不能伪造程序证据、订正值或“无需复核”标志；
2. AI 发现不能自行声明 `deterministic` 并跳过第二次复核；
3. OCR 事实只有在来源行可追溯时才能进入程序规则；
4. 图片链路实际执行“千帆 DeepSeek-OCR 优先，本地 OCR 仅降级”；
5. Vercel Preview 能安全显示当前配置状态，从而定位 `OCR_HTTP_401_INVALID_APPID`；
6. 增加资源边界、可复现安装、服务端构建检查和持续集成。

本次不更换诊断产品流程，不引入用户账号系统，也不把 AI 升级为数学真值来源。

## 2. 已确认原则

- 只有服务端程序规则可以生成可证明的 `correctedValue`。
- 用户可以选择采用订正值或保留原值，但不能提交一组新的原值、订正值冒充程序结果。
- AI 返回的每条发现都视为 AI 生成内容；模型输出的 `deterministic`、`crossModelStatus` 和 `review` 字段没有权限意义。
- 第二次复核失败时必须明确标记 `review_unavailable`，不能伪装为已复核或 `program_fact`。
- OCR 原文是候选来源；结构化事实必须同时锚定业务范围、指标、值与单位。
- 配置诊断不得返回密钥、Authorization Header、完整第三方错误正文或可逆密钥片段。

## 3. 服务端可信证据边界

### 3.1 分析凭证

`/api/analyze-file` 完成解析、审计、程序复算与报表检查后，生成一个短期 `analysisToken`。Token 使用 HMAC-SHA256 签名，格式为版本化的 Base64URL 载荷与签名，载荷包含：

- `type: "analysis"`、签发时间、过期时间；
- 文件摘要，不包含原始 Base64 或完整 OCR 全文；
- 服务端生成的审计摘要；
- 带稳定 ID 的程序订正候选；
- 可信报表事实、程序问题与待确认项。

浏览器可以读取这些业务内容用于展示，但不能修改后继续通过验签。Token 默认有效 6 小时，数量、字符串长度和总载荷均有上限。

签名密钥优先读取 `EVIDENCE_SIGNING_SECRET`。为兼容当前已部署环境，可从现有 `DEEPSEEK_API_KEY` 通过带固定用途标签的 HMAC 派生专用签名密钥；两者都不存在时，文件分析安全失败，不返回未签名的“可信证据”。生产环境建议单独配置 `EVIDENCE_SIGNING_SECRET`。

### 3.2 用户订正选择

浏览器只提交：

```json
{ "correctionId": "correction_<文件摘要>_1", "decision": "accepted" }
```

或：

```json
{ "correctionId": "correction_<文件摘要>_1", "decision": "kept_original" }
```

`/api/diagnosis` 验证 `analysisToken` 后，根据 Token 中的原值和程序订正值重建 `correction_decision`。未知 ID、重复决定、非法 decision 或被篡改 Token 均不能进入模型上下文。

### 3.3 客户端普通证据

老板文字回答、对话和普通业务说明仍可作为用户输入。服务端从客户端 `diagnosis.evidence` 中拒绝所有保留前缀，包括：

- `file_analysis:`
- `file_review:`
- `report_fact:`
- `report_issue:`
- `report_review_confirmation:`
- `correction_decision:`
- `program:`

这些类型只能由验签后的服务端载荷重建。原始 `diagnosis.findings` 也不再拥有可信状态。

### 3.4 诊断结果凭证

`/api/diagnosis` 在完成第二次复核并做字段清洗后，签发 `diagnosisToken`，其中只保存有界的最终 findings。继续问诊时，服务端只从有效 `diagnosisToken` 恢复上一轮 findings；下载 Excel 报告时也只接受该 Token 中的 findings。

`/api/report` 不再相信浏览器提交的 `audit` 或 `findings`：审计由原始 Excel 在服务端重新计算，AI findings 从 `diagnosisToken` 验证后取得。

单文件 Excel 报告只接受绑定唯一文件摘要的 `diagnosisToken`。多文件联合诊断可以继续用于问诊，但在没有逐 finding 来源归属前，不允许把混合结论直接写入任一单独工作簿。

## 4. AI 结果与第二次复核

主模型返回后、结构验证前，服务端统一删除 AI finding 中的：

- `deterministic`
- `crossModelStatus`
- `review`

并把所有 AI findings 设为非确定性内容。任何 JSON 字段都不能令复核短路。

正常情况下，每批 findings 必须发起一次独立 reviewer 调用。Reviewer 成功时沿用现有交叉复核降级规则；Reviewer 缺失或调用失败时，结果保留但标记 `crossModelStatus: "review_unavailable"`，且不得升级为 `program_fact`。只有服务端自身构造的确定性规则结果可以使用程序事实语义。

## 5. OCR 来源锚定与完整性

### 5.1 结构化事实要求

结构化提示词要求 `sourceText` 是能够独立核对的组合引用；表格场景需包含相关表头和当前数据行，而不是只返回孤立数字。

标准化层只保留同时满足以下条件的事实：

- `value` 可在 `sourceText` 中按允许的数字格式归一化后找到；
- `scope` 可在 `sourceText` 中找到；
- `metric` 本身或受控别名可在 `sourceText` 中找到；
- 非空 `unit` 或其等价表示可在 `sourceText` 中找到；生产/失效等日期指标可用严格、有效且已锚定的日历日期作为单位等价表示；
- `sourceText` 确实来自 OCR 全文。

不满足条件的模型输出转为待确认或丢弃，不能进入程序复算。事实 ID 由服务端重新生成并保持唯一，候选和确认项通过映射后的 ID 关联。

### 5.2 空结构化结果

云 OCR 虽成功，但结构化层没有得到任何有效事实时：

- `completeReview` 必须为 `false`；
- 返回 `REPORT_STRUCTURE_EMPTY`；
- 页面显示“文字已读取，但未形成可复核经营字段”；
- 不能展示“完整检查”或“0 个问题即通过”。

## 6. OCR 执行顺序

图片文件先完成扩展名、文件头和大小校验，但不立即启动 Tesseract。随后执行：

```text
文件校验
  → 千帆 DeepSeek-OCR
    → 成功：使用云 OCR 文本
    → 失败：再启动本地 Tesseract
      → 成功：local_ocr_degraded
      → 失败：ocr_unavailable
```

`src/documents/parse.js` 拆出可单独调用的图片识别函数，并支持“只校验、延迟本地 OCR”。`api/analyze-file.js` 负责按上述顺序调度。最终返回的 `document.text`、识别模式与警告必须来自实际采用的 OCR 路径，避免云 OCR 成功但页面仍展示本地 OCR 文本。

## 7. Vercel 安全配置诊断

新增只读 `/api/health`，设置 `Cache-Control: no-store`，仅返回：

- 当前 `VERCEL_ENV` / `NODE_ENV`；
- Git 分支与提交 SHA 的短标识；
- Vercel 仓库/项目可用的非秘密标识；
- `QIANFAN_API_KEY` 是否存在；
- Key 是否符合预期 `bce-v3/` 格式；
- `QIANFAN_APP_ID` 是否已配置（只返回布尔值，不返回 AppID）；
- 当前 `QIANFAN_OCR_MODEL`；
- `DEEPSEEK_API_KEY` 是否存在与当前模型；
- 证据签名能力是否可用，以及使用显式密钥还是派生密钥；
- 总体 `ok` 与安全错误码。

接口绝不输出密钥内容、长度、尾号、哈希或百度返回正文。`QIANFAN_API_KEY` 存在但不是预期格式时，健康检查返回 `QIANFAN_KEY_FORMAT_UNEXPECTED`，使 Preview 配置错误能在调用 OCR 前被发现。

部署验证必须把健康接口显示的环境、分支、短 SHA 与 PR17 当前 Preview 对齐。若 Key 状态正确但百度仍返回 `OCR_HTTP_401_INVALID_APPID`，下一步才进入百度侧 API Key 类型、千帆权限与 AppID 绑定排查。

根据千帆官方权限说明，AppID 对普通预置模型调用不是必传参数；但启用了细粒度权限并绑定应用的 API Key，可能要求请求中的 `appid` 与授权对象一致。因此调用层支持可选 `QIANFAN_APP_ID` Header，未配置时完全省略，配置时也不得出现在健康检查或日志中。

## 8. 资源与构建保护

- `/api/report` 使用与其他高成本接口一致的突发请求保护。
- Token、证据、findings、工作表、行、列和单元格数量均设置明确上限；超限返回可识别的 4xx，不继续生成报告或调用模型。
- PDF、DOCX、本地 OCR 与第三方请求继续使用有界超时；任何超时不泄露内部错误。
- 增加 `.gitignore`，排除 `node_modules/`、`dist/`、日志和本地环境文件。
- 生成并纳入 `package-lock.json`，CI 使用 Node 20 和 `npm ci`。
- `npm run build` 在复制静态文件后执行服务端模块导入检查，避免只构建前端却遗漏 API 导入错误。
- GitHub Actions 执行安装、完整测试和构建。

内存中的单实例 burst limit 仍不是跨实例限流。本轮把所有接口纳入相同保护并限制单次资源；跨实例配额需要后续接入 Vercel Firewall、KV 或其他共享存储，不在本次代码补丁中假装已经解决。

## 9. 错误处理

- Token 缺失、过期、类型错误或验签失败：返回 400/422 的通用中文错误，不说明签名细节。
- 服务端缺少签名能力：返回 503，并通过 `/api/health` 给出非秘密配置状态。
- Reviewer 失败：记录请求 ID、阶段、耗时和错误类型；返回 `review_unavailable`，不泄露 provider 正文。
- 云 OCR 失败：保留现有安全百度错误分类，然后才启动本地 OCR。
- 云 OCR 和本地 OCR 均失败：停止结构化与诊断证据签发。
- 报告下载 Token 无效：拒绝生成；不回退使用客户端 findings。

## 10. 测试与验收

所有行为变更按 TDD 实施，每项先写能复现原问题的失败测试。

必须覆盖：

1. 篡改 `analysisToken`、过期 Token、错误类型和错误密钥均无法生成可信证据；
2. 客户端伪造 `report_issue`、`correctedValue`、`program:` 或 `deterministic:true` 不会进入模型上下文，也不能跳过 reviewer；
3. 合法 correction ID 的 accepted/kept_original 由服务端重建正确值；
4. AI 返回 `deterministic:true` 时 reviewer 仍被调用，最终状态绝不是 `program_fact`；
5. OCR 事实缺 scope、metric、unit 或来源引用时不能进入规则引擎；
6. 云 OCR 成功时 Tesseract 不运行，云 OCR 失败时才运行；
7. 零有效事实时 `completeReview=false` 且错误码为 `REPORT_STRUCTURE_EMPTY`；
8. `/api/health` 能区分 missing、unexpected-format、configured，响应中不含任一测试密钥；
9. `/api/report` 重新审计原文件，只使用有效 `diagnosisToken` findings，并有请求/载荷上限；
10. 完整 `npm test`、`npm run build` 和 CI 配置测试通过。

部署阶段的最终验收：

- PR17 Preview 的健康接口显示正确环境、分支和提交；
- `QIANFAN_API_KEY` 显示存在且为预期格式；
- 同一真实报表图片完成云 OCR，或返回新的可定位安全错误码；
- 诊断请求中伪造的程序证据被拒绝；
- 正常可信证据经过第二次复核后可继续生成诊断与 Excel 报告。

## 11. 非目标与后续项

- 本轮不新增登录、组织、商家或门店权限模型；
- 本轮不购买百度套餐，也不更换已确认的 `deepseek-ocr` 模型；
- 本轮不把本地 OCR 恢复为主链路；
- 本轮不引入达人/探店数据接口，这些后续能力通过独立的数据适配器接入同一可信证据边界；
- 跨实例配额、持久审计日志和密钥轮换流程另立规格处理。
