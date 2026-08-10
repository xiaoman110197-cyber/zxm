# 经营问诊器：进度、韧性与体验加固设计

## 目标

在不改变现有“自由描述问题 → AI 动态追问 → 文件辅助证据 → P0/P1/P2 诊断”主流程的前提下，解决长时间文件分析无反馈、移动端切后台后的失败体验、AI 单点故障、公开 API 成本暴露和缺少连续使用体验的问题。

用户已明确授权本轮在不需要其账号操作的范围内自主修复与完善；需要 Vercel 控制台、付费服务、真实商家资料或账户权限的事项留作人工验收清单。

## 已确认现状

1. 文件上传使用浏览器 FileReader → Base64 JSON → `/api/analyze-file`，前端仅显示“正在分析…”，服务器返回最终 JSON 前没有阶段反馈。
2. 图片使用 Tesseract.js `chi_sim + eng` OCR；每次请求创建并销毁 worker。官方 Tesseract.js 支持 logger 反馈初始化/识别进度。
3. Vercel Node Functions 支持流式响应；当前 `vercel.json` 未为分析函数声明 `maxDuration`。
4. 无法取得刚才失败请求的 Vercel Runtime Logs（当前连接器对该项目日志返回 403），因此不能把该次失败归因于“切换画面”。必须增加可追踪 requestId、阶段日志和用户可见错误编号后再判断。
5. 当前 AI 路由在 DeepSeek 作为 primary 时，OpenAI 仅作为 reviewer；primary 抛错会直接返回 502，未实现此前确定的完整 provider failover。
6. reviewer 调用抛错也会使整次诊断失败，而不是保留 primary 结果。
7. 当前页面不保存问诊草稿；刷新/系统回收页面后对话会丢失。文件本体不应写入 localStorage。

## 设计决策

### A. 文件分析进度：真实阶段 + OCR 真实细分进度

保持 `/api/analyze-file` 的 JSON 响应兼容已有测试和客户端；新增同一路由的 `?stream=1` 流式模式，使用 POST + `text/event-stream`。前端通过 `fetch()` 读取 Response.body，不使用 EventSource，因为上传是 POST。

事件协议：
- `progress`: `{requestId, phase, percent, message}`
- `result`: 现有 analyze-file 成功 payload
- `error`: `{requestId, error, code}`，不向客户端暴露内部 stack/第三方原始错误

阶段百分比是固定映射，不伪装成逐字节精确值：准备/校验/解析/审计/整理分别对应区间；图片 OCR 的识别区间使用 Tesseract logger 的实际 `progress`。界面明确使用“分析进度”而不是“精确剩余时间”。

手机 UI 在现有文件状态区域显示：进度条、百分比、当前步骤、已用秒数、取消按钮。低于 100% 时 `aria-valuenow` 实时更新。

### B. 切后台和网络中断

不声称可以在无持久任务队列的情况下做到“后台绝对不中断”。当前版本采用可恢复失败：
- 不因 `visibilitychange` 主动 abort；
- 保留当前 File 对象在内存中；
- 网络/连接中断后显示明确原因和“重新分析”按钮；
- 用户主动取消使用 AbortController；
- 新分析只有成功后才替换上一个有效文件分析结果，失败不能把之前的有效诊断资料清空；
- 页面刷新后 File 对象无法恢复，提示重新选择文件。

真正跨页面/跨设备后台任务需要持久任务存储，留到后续账户体系/数据库阶段。

### C. OCR 与 Vercel 时限

为 `api/analyze-file.js` 配置 `maxDuration: 60` 秒；不启用可能改变计费/运行模式的额外 Vercel 产品设置。

Tesseract worker 仍采用单请求生命周期，避免未经并发设计就共享全局 worker。先通过流式进度和更长函数时限解决体验/超时，再基于真实运行日志决定是否做 worker 池或本地语言包缓存。

### D. AI 故障切换与超时

Provider 接口增加请求超时。默认：primary 12 秒；fallback 12 秒；review 8 秒。

路由：
- DeepSeek key + OpenAI key：DeepSeek primary，OpenAI fallback；需要复核时 OpenAI reviewer。
- 只有 DeepSeek：DeepSeek 独立完成。
- 只有 OpenAI：OpenAI 独立完成。
- primary 失败且 fallback 可用：把同一完整 diagnosis 上下文交给 fallback 独立 diagnose。
- reviewer 失败：保留已验证的 primary/fallback 结果，标记 crossModelStatus=`review_unavailable`，不能让整次诊断失败。
- 两个 diagnose 都失败：返回 502，客户端给出可重试提示和 requestId，不编造固定诊断。

### E. 输入边界与成本保护

服务器在调用 AI 前限制诊断上下文：
- 最多 30 个 owner turns；
- 单条文本最多 4,000 字符；
- 最多 3 份 document；
- document 提取文本仍保持现有 12,000 字符上限；
- findings/evidence 数量设置合理上限；
- 模型输出 token 设置上限。

增加模块级 best-effort IP burst limiter 作为第一层防刷，并在文档中明确它不是全局分布式限流。真正可靠的公开 API 防刷需要 Vercel Firewall/账户身份或外部限流存储，列为用户回来后的控制台项。

### F. 可观测性和错误隐私

每个 `/api/analyze-file` 与 `/api/diagnosis` 请求生成 requestId；日志记录阶段、耗时、provider、状态码，不记录上传原文、文件内容、API key 或完整老板回答。

客户端错误只显示中文错误类别 + 错误编号。第三方 API 原始响应、内部路径、stack 仅服务器日志可见。

### G. 手机连续使用体验

增加轻量 localStorage 草稿：保存对话文本、owner answers、findings、更新时间和版本号；不保存原始文件/Base64，不持久化提取出的文件全文。重新打开页面时可恢复问诊文字和报告，并提示“上传资料需重新选择”。

增加“开始新问诊”按钮，清空本地草稿并生成新 diagnosis id。AI 请求失败时不让老板重新输入本轮内容，提供“重试本轮”。

AI 问题可显示简短“为什么问这个”，使用模型返回的 reason；默认弱化显示，不抢主问题视觉层级。

### H. 安全响应头

在 Vercel 配置加入适合纯同源应用的 CSP、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`。不加入会阻止未来手机拍照文件选择的激进 camera 策略。

## 本轮不做

- 不上登录/会员/支付；
- 不接数据库和跨设备历史；
- 不承诺扫描 PDF OCR；
- 不一次支持多文件合并；
- 不做“经营健康分”等证据不足的装饰指标；
- 不引入推送通知或营销消息；
- 不修改真实商家原文件。

## 验收标准

1. 图片上传能看到从准备到 OCR 到整理的阶段、百分比与耗时；OCR 识别阶段使用 Tesseract 实际进度。
2. 文件流式请求成功时结果与原 JSON API 一致；不支持/流式异常时有明确错误，不静默卡住。
3. 网络中断后保留待重试文件（页面未被系统销毁时），且不会清除此前成功的分析结果。
4. DeepSeek diagnose 失败时 OpenAI 能用完整上下文接管；reviewer 失败不影响主结果。
5. 关键 API 有 timeout、输入上限、请求 ID；客户端不显示第三方原始错误。
6. 刷新后可恢复文字问诊和 findings，但不会把原始上传文件写入 localStorage。
7. 全量测试和生产 build 通过；Vercel Preview 两个项目部署成功后才允许合并 main。
