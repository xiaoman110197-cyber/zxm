# DeepSeek OCR 报表诊断链路设计

日期：2026-08-11
状态：待用户规格确认

## 1. 目标

把当前依赖 OpenAI 视觉接口的报表图片分析链路，改造成面向中国大陆可稳定部署的方案：

1. 百度智能云千帆 `deepseek-ocr` 负责读取报表原图并尽量恢复表格结构；
2. DeepSeek V4 只负责处理 OCR 后的文本，把它整理成结构化经营事实，并在后续做经营分析与复核；
3. 确定性程序继续负责毛利率、比例、合计、日期逻辑等可证明计算；
4. 百度 DeepSeek-OCR 失败时，现有本地 OCR 作为降级兜底；
5. OpenAI 从运行时主链路中彻底停用，不再作为报表视觉或经营诊断的依赖。

核心成功标准不是“接口能返回”，而是：老板上传报表后，系统能指出具体错误、给出程序可证明的订正值，并对无法证明的异常明确标记为待确认。

## 2. 已确认的产品原则

### 2.1 AI 不拥有最终数学真值

DeepSeek 体系可以：
- 由 `deepseek-ocr` 读取图片、恢复文档和表格文本；
- 由 DeepSeek V4 从 OCR 文本恢复字段、行列、部门、区域、SKU、日期之间的关系；
- 提出异常候选；
- 做经营解释和提出追问。

DeepSeek 不可以：
- 自行生成 `correctedValue` 并把它当成事实；
- 在没有明确证据时补全缺失数字；
- 把异常直接写成确定错误；
- 覆盖程序已经证明的计算结果。

只有确定性程序可以生成可证明的订正数字。

### 2.2 降级模式不能制造“报表没问题”的假象

如果云端 DeepSeek-OCR 失败，只剩本地 OCR，则页面必须明确显示降级状态。

在降级模式中：
- 可以显示疑似问题和待确认项；
- 可以运行程序规则辅助发现矛盾；
- 但不得把“0 个确定问题”展示成“报表无问题”；
- 依赖低可信 OCR 字段得出的结论默认进入 `needs_confirmation`，除非后续有足够证据确认。

### 2.3 用户确认仍是进入经营诊断前的门槛

报表检查完成后，关键订正或冲突字段仍需要用户确认，确认后的结构化证据才进入后续经营诊断。

### 2.4 “程序证明”不等于“原图绝对识别正确”

程序只能证明：在已经提取出的同一行、同一业务范围、单位兼容的输入数字成立时，某个公式结果是否正确。

因此：
- 硬订正必须保留原始 `sourceText` 以便追溯；
- 参与复算的操作数必须能追溯到明确 OCR 来源，且属于相同 scope/row；
- 出现行列冲突、表头歧义、单位冲突时，不产生硬订正，转为 `needs_confirmation`；
- 用户确认仍用于防止 OCR 把原图数字读错后造成“算得对、抄得错”。

## 3. 推荐架构

### 3.1 正常模式

```text
报表图片
  ↓
百度千帆 DeepSeek-OCR
  ↓
版面/表格文本（Markdown / table-like text）
  ↓
DeepSeek V4 结构化解析
  ↓
report facts + anomaly candidates
  ↓
确定性规则引擎
  ↓
program-proven issues / logic errors / anomalies
  ↓
用户确认
  ↓
DeepSeek V4 经营诊断
  ↓
DeepSeek V4 规则化复核
```

运行模式标识：`cloud_ocr_deepseek`。

### 3.2 降级模式

```text
百度 DeepSeek-OCR 失败
  ↓
现有本地 OCR
  ↓
DeepSeek V4 结构化辅助
  ↓
程序规则检查
  ↓
疑似问题 / 待确认
```

运行模式标识：`local_ocr_degraded`。

该模式的 UI 必须带有类似语义：

> 云端报表识别未完成，本次使用降级识别。关键数字需要核对，结果不能视为完整报表检查。

### 3.3 完全失败模式

如果云端 OCR 与本地 OCR 均无法得到可用文本：
- 不进入经营诊断；
- 返回明确的识别失败状态；
- 提示用户重试、换清晰图片或重新上传；
- 不返回空的“0 问题”结果。

运行模式标识：`ocr_unavailable`。

## 4. 百度千帆 DeepSeek-OCR 接入

采用百度智能云千帆当前官方 DeepSeek-OCR 接口：
- 模型：`deepseek-ocr`
- 接口：千帆 `/v2/chat/completions`
- 鉴权：Bearer API Key
- 图片输入：Base64 Data URL，避免为了识别额外暴露临时公网图片地址
- 单张图片遵守官方 10MB 限制

首版提示词优先使用官方支持的表格/图形解析语义，例如 `Parse the figure.`；必要时同时要求尽量保持原始行列结构，不做业务修正。

新增环境变量：
- `QIANFAN_API_KEY`
- `QIANFAN_OCR_MODEL=deepseek-ocr`（可选，默认固定为 `deepseek-ocr`）

安全要求：
- API Key 只在服务端读取；
- 日志禁止输出 Key、Authorization Header 或完整第三方错误正文；
- 对外只暴露安全错误码。

建议错误码：
- `OCR_HTTP_401`
- `OCR_HTTP_429`
- `OCR_TIMEOUT`
- `OCR_DNS_ERROR`
- `OCR_CONNECT_TIMEOUT`
- `OCR_CONNECTION_RESET`
- `OCR_TLS_ERROR`
- `OCR_EMPTY_OUTPUT`
- `OCR_RESPONSE_JSON`
- `OCR_NETWORK_ERROR`

## 5. DeepSeek V4 结构化层

现有项目已经有 DeepSeek Provider。首版继续使用官方 DeepSeek Chat Completions API，模型默认 `deepseek-v4-flash`。

新增一个独立职责，而不是把所有逻辑塞进现有 diagnosis prompt：

`structureReportText(ocrPayload)`

输入：
- 云端 OCR 返回的表格/Markdown 文本，或降级本地 OCR 文本；
- 文件元信息；
- 识别模式。

输出只允许：
- `facts`
- `candidates`
- `confirmations`

事实建议字段：
- `id`
- `scope`
- `metric`
- `value`
- `unit`
- `sourceText`
- `source`
- `confidence`

约束：
- `value` 必须能从输入 OCR 文本中的对应来源追溯得到；允许标准化逗号、小数点、百分号、空格等显示格式，但不能凭空补值；
- `sourceText` 必须保留可追溯原文；
- 模型即使输出 `correctedValue`，标准化层也必须丢弃；
- 不兼容单位、模糊表头、行列关系不确定时，应生成 confirmation，而不是硬拼事实。

## 6. 程序规则与证据等级

现有确定性规则继续作为订正权威。

### 可直接计算的例子

若结构化事实明确得到：
- 华南收入 9800
- 华南成本 6100
- 华南报表毛利率 85%

且这三个字段属于同一行/同一 scope、单位兼容并有可追溯来源，程序才按既定公式复算。确认报表毛利率与计算值不符后，才可以生成 `correctedValue`。

### 只能标异常、不能给替代值的例子

- 成本为负数；
- 净利润大于收入；
- 出勤率超过 100%；
- 人数为负；
- 周转率为负；
- 生产日期晚于当前日期；
- 保质期早于生产日期。

这些可以判定逻辑异常，但不能编造正确替代值。

### 单位规则

在计算前继续统一处理元、千元、万元、亿元等单位；若单位缺失、冲突或无法可靠换算，不产生硬订正。

## 7. UI 状态设计

老板首先看到“哪里错了”，而不是 OCR 技术细节。

### `cloud_ocr_deepseek`
显示：
- 可以确定的计算/逻辑问题；
- 需要确认的异常；
- 可展开查看识别来源。

### `local_ocr_degraded`
页面顶部固定显示降级说明；问题区使用“疑似 / 需要核对”语义，不把 0 个确定问题包装成通过检查。

### `ocr_unavailable`
直接显示识别失败与重试操作，不进入经营诊断。

OCR 原文继续放在折叠区域，不作为老板主界面。

## 8. OpenAI 移除范围

本次目标是运行时不依赖 OpenAI：
- 报表图片分析不再调用 OpenAI Responses API；
- 经营诊断和复核不再选择 OpenAI Provider；
- `OPENAI_API_KEY` 不再是部署要求；
- 清理已经没有运行时引用的 OpenAI Provider / Vision 代码与对应配置，但只在测试证明无引用后删除；
- 不保留“OpenAI 自动备用”逻辑。

## 9. 故障与回退规则

1. 百度 OCR 成功：继续正常链路。
2. 百度 OCR 401/429/超时/网络错误/空输出：记录安全错误码，立即回退本地 OCR。
3. 本地 OCR 可用：进入 `local_ocr_degraded`。
4. 本地 OCR 不可用：进入 `ocr_unavailable`，停止后续诊断。
5. DeepSeek V4 结构化失败：不允许直接把原始 OCR 当成可信结构化事实；页面提示结构化失败并要求重试/确认。
6. DeepSeek V4 经营诊断失败：报表程序检查结果仍可保留，不因诊断模型失败而丢失已经证明的问题。

## 10. 测试策略

实施必须按 TDD 进行。

### 单元测试

- 千帆请求使用 `deepseek-ocr` 与 Base64 Data URL；
- API Key 被 trim，日志不泄露；
- 401 / 429 / timeout / DNS / TLS / reset 分类；
- 空返回与坏 JSON 分类；
- DeepSeek 结构化层不能把不存在于 OCR 文本的数字升级为可信事实；
- 模型返回 `correctedValue` 时必须被删除；
- 不兼容单位不能生成硬订正；
- 跨行/跨 scope 混配数字不能生成硬订正；
- 降级模式不得输出“报表无问题”语义。

### 集成测试

至少覆盖：

1. 百度 OCR 成功 + DeepSeek 结构化成功 + 程序发现错误；
2. 百度 OCR 失败 + 本地 OCR 成功；
3. 两种 OCR 都失败；
4. DeepSeek 结构化输出错误 JSON；
5. DeepSeek 与程序计算冲突时程序结果不被覆盖；
6. 没有任何 OpenAI 网络调用；
7. 确认后的结构化事实能进入后续经营诊断。

### 参考报表验收

继续使用当前 `IMG_0511.png` 作为固定回归样例。期望系统至少能够正确识别并处理：
- 华南毛利率计算错误；
- 华北负成本异常；
- 跨境电商净利润大于收入；
- 出勤率 105%；
- 负人数；
- 负周转率；
- 未来生产日期；
- 保质期早于生产日期；
- 总毛利率直接相加类聚合错误。

对于能通过程序证明的项目，数值必须复算正确；无法证明替代值的项目只能标异常。

## 11. 验收标准

第一阶段只有同时满足以下条件才算成功：

1. 同一张参考报表不再依赖 OpenAI；
2. 百度 DeepSeek-OCR 能返回可恢复表格关系的内容；
3. DeepSeek V4 能把关键行列整理成可追溯 `facts`；
4. 程序能正确复算参考报表中的确定性错误；
5. 降级模式不会误导用户认为报表已通过检查；
6. 所有旧测试和新增测试通过；
7. production build 通过；
8. Vercel Preview 环境用真实 API Key 做一次同图实测；
9. 实测结果与参考预期逐条对照，不以“接口 200”代替效果验收。

## 12. 明确不在本阶段做的事情

为了控制范围，首版不做：
- 同时接 Qwen-OCR / PaddleOCR 做常态双模型投票；
- 自部署 DeepSeek-OCR GPU 服务；
- 多页 PDF 的复杂文档拆页系统；
- 自动修正老板报表原文件；
- 把 AI 候选异常直接升级成确定错误。

如果第一阶段实测证明百度 DeepSeek-OCR 对复杂表格仍不稳定，再单独设计第二视觉证据源，而不是现在先堆模型。