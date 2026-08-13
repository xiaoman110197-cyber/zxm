# 老板经营诊断 AI / zhenduan

面向老板的经营诊断 Web 应用。当前报表链路以“可追溯证据 + 程序复算”为核心，不把模型猜测包装成确定事实。

## 报表图片链路

```text
报表图片
  → 百度智能云千帆 deepseek-ocr 读取原图/表格
  → DeepSeek V4 将 OCR 文本整理为可追溯 facts / candidates / confirmations
  → 确定性程序复算公式、单位和日期逻辑
  → 老板确认关键数据
  → DeepSeek V4 经营诊断
  → DeepSeek V4 第二次独立复核
```

如果千帆云端 OCR 暂时失败，现有 Tesseract 本地 OCR 只作为降级兜底。降级结果会明确标记为不完整，不能把“0 个可证明问题”理解为“报表没有问题”。如果云端和本地 OCR 都无法得到可用文本，则阻止这份报表进入后续经营诊断并要求重新上传清晰图片。

## 移动端资料分析

当前资料分析采用普通请求/响应模式，优先保证页面保持打开时的稳定性。分析期间请保持当前页面打开；切到后台、锁屏或关闭页面后，移动浏览器可能中断请求，此版本不会承诺后台继续执行。失败后可直接重新分析。

报表识别业务链路仍为：千帆 DeepSeek-OCR → DeepSeek 结构化 → 程序复算 → 老板确认。传输层失败与 OCR/模型失败分开显示，不能把浏览器 `Load failed` 误判成千帆计费或模型故障。

## 真实性原则

- AI 可以读取、结构化、解释和提出异常候选。
- 只有确定性程序可以生成可证明的 `correctedValue`。
- 无法证明正确替代值的异常只标记为异常或待确认，不编造答案。
- 关键字段必须能追溯到 OCR 原文；关系不清、单位冲突或低可信数据不用于硬订正。
- 老板确认后的可信结构化证据才进入后续经营诊断。

## 部署环境变量

服务端配置：

```text
QIANFAN_API_KEY       必填：千帆 deepseek-ocr 云端图片识别
QIANFAN_OCR_MODEL     可选：默认 deepseek-ocr
QIANFAN_APP_ID        可选：仅当 API Key 被细粒度权限绑定到指定 AppID 时配置
DEEPSEEK_API_KEY      必填：报表结构化、经营诊断和复核
DEEPSEEK_MODEL        可选：默认 deepseek-v4-flash
EVIDENCE_SIGNING_SECRET 推荐：独立的短期证据签名密钥
```

API Key 只能保存在服务端环境变量中，不应写入前端代码、仓库、日志或截图。

部署后访问 `/api/health` 可安全核对当前环境、分支、短提交 SHA、项目标识、模型名，以及 Qianfan Key 是否存在/是否为 `bce-v3` 格式。该接口只显示 `QIANFAN_APP_ID` 是否已配置，不返回 AppID 或任何密钥内容，并设置 `Cache-Control: no-store`。

Vercel 的 Preview 与 Production 环境变量相互独立。修改环境变量后，需要为目标环境创建一次新部署；检查健康接口时，应把返回的分支和短 SHA 与当前 PR 的提交对齐。如果同一 GitHub 提交出现多个 Vercel 检查项，必须先确定实际测试的项目，避免在旧项目或错误 Preview 上排查。

若健康接口显示 Key 为 `bce-v3` 且仍返回 `OCR_HTTP_401_INVALID_APPID`，再检查该 Key 是否启用了千帆细粒度权限：受限 Key 可能要求同时发送它绑定的 AppID，此时才配置 `QIANFAN_APP_ID`。普通未绑定 Key 不需要设置该变量。

每次修改报表识别主链路后，必须在 Preview 环境用同一张参考报表做真实上传测试，确认进度依次经过 `cloud-ocr → structuring → report-check → complete`，并确认结果模式为 `cloud_ocr_deepseek`。没有真实 Preview 验证时，不应仅凭单元测试宣称云端报表识别已经可用。

## 当前支持

- Excel / CSV 的确定性数据检查
- PDF / DOCX 文本提取
- JPG / PNG 报表图片识别与复算
- 报表问题、可证明订正、异常和待确认项分开展示
- 移动端上传、确认和继续诊断
- 经营诊断结果的证据约束与第二次复核

> 原则：无法直接获得的数据不伪装成实时能力；证据不足时追问或标记待确认，而不是猜测。
