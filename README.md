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
DEEPSEEK_API_KEY      必填：报表结构化、经营诊断和复核
DEEPSEEK_MODEL        可选：默认 deepseek-v4-flash
```

API Key 只能保存在服务端环境变量中，不应写入前端代码、仓库、日志或截图。

每次修改报表识别主链路后，必须在 Preview 环境用同一张参考报表做真实上传测试，确认进度依次经过 `cloud-ocr → structuring → report-check → complete`，并确认结果模式为 `cloud_ocr_deepseek`。没有真实 Preview 验证时，不应仅凭单元测试宣称云端报表识别已经可用。

## 当前支持

- Excel / CSV 的确定性数据检查
- PDF / DOCX 文本提取
- JPG / PNG 报表图片识别与复算
- 报表问题、可证明订正、异常和待确认项分开展示
- 移动端上传、确认和继续诊断
- 经营诊断结果的证据约束与第二次复核

> 原则：无法直接获得的数据不伪装成实时能力；证据不足时追问或标记待确认，而不是猜测。
