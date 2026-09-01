# @tiegongji/protocol-sdk

铁公鸡的协议层 —— 模型协议转换库，提供 **OpenAI ↔ Anthropic** 消息格式的双向纯转换。无 UI、无 HTTP、无副作用，不依赖其他 sdk，仅供 `web` 层等上游消费。

## 用途

- **双向转换**：请求 / 消息 / 响应 / 内容块 / 工具定义与调用，两套协议的完整桥接，纯函数无状态。
- **流式支持**：SSE 解析与序列化，以及 OpenAI `chat.completion.chunk` ↔ Anthropic `stream event` 的逐事件互转（自动补发/吞掉无对应物的生命周期事件）。
- **设计取舍**：协议独有的字段（如 OpenAI `response_format` / `max_completion_tokens`）有意不映射到另一侧，转换保持最小语义等价。
- **统一错误**：转换失败抛 `ProtocolConversionError`，携带转换方向与上下文便于定位。
- **按需引入**：包导出 `"."`（全量）、`"./openai"`、`"./anthropic"` 三个入口，可只引入所需协议侧。

## 使用示例

```ts
import {
  convertOpenAIRequestToAnthropic,
  convertAnthropicResponseToOpenAI,
  parseSSEStream,
  convertOpenAIChunkToAnthropicEvents,
} from '@tiegongji/protocol-sdk';

// 1. 请求转换：OpenAI chat.completions 请求 → Anthropic messages 请求（转发给 anthropic 上游）
const anthropicBody = convertOpenAIRequestToAnthropic(openAIReq);
//    → { model, messages, max_tokens, system?, temperature?, tools?... }

// 2. 响应转换：Anthropic messages 响应 → OpenAI chat.completions 响应（回给 OpenAI 兼容客户端）
const openAIRes = convertAnthropicResponseToOpenAI(anthropicJson);
//    → { id, object: 'chat.completion', choices: [{ message, finish_reason }], usage?... }

// 3. 流式：解析上游 SSE 帧
for await (const event of parseSSEStream(upstream.body)) {
  // { data, event?, id? } —— data 为原始字符串，可再按协议解析
}

// 4. 流式互转：OpenAI 分片 → Anthropic 事件序列（自动补发 message_start / content_block 生命周期）
const events = convertOpenAIChunkToAnthropicEvents(chunk, { index: 0 });
//    → [message_start?, content_block_start?, content_block_delta?, content_block_stop?, message_delta?, message_stop?]
```

## 公共 API

| 导出 | 说明 |
|------|------|
| 请求 | `convertOpenAIRequestToAnthropic` / `convertAnthropicRequestToOpenAI` |
| 消息 | `convertOpenAIMessageToAnthropic` / `convertAnthropicMessageToOpenAI` |
| 响应 | `convertAnthropicResponseToOpenAI` / `convertOpenAIResponseToAnthropic` |
| 内容块 | `convertOpenAIContentPartToAnthropic` / `convertAnthropicContentBlockToOpenAI`、base64 data URL 工具 |
| 工具 | `convertOpenAIToolToAnthropic` / `convertAnthropicToolToOpenAI`、tool call / tool choice 互转 |
| 流式 | `parseSSEStream` / `serializeSSEEvent`、`convertOpenAIChunkToAnthropicEvents` / `convertAnthropicEventToOpenAIChunk` |
| 错误 | `ProtocolConversionError`（含 `direction` / `context`） |
| 类型 | `OpenAI*` / `Anthropic*` 全量请求响应类型 |

## 结构

```text
src/
├── index.ts             # 公共导出入口
├── openai/              # OpenAI 侧：类型 + 请求/消息/响应转换
├── anthropic/           # Anthropic 侧：类型 + 请求/消息/响应转换
├── shared/              # 跨协议共享：内容块 / 工具 / 错误
└── stream/              # SSE 与流式分片互转
```
