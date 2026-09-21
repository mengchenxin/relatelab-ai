import type {
  AnalysisRequest,
  Dynamics,
  RedactionReport,
  SafetyAssessment,
  Timeline
} from "../../shared/contracts.ts";

export const PROMPT_VERSION = "relatelab-v1";

export const safetySystemPrompt = `
你是 RelateLab 关系案例工作台中的分析系统。
分析沟通模式，不给人格下结论，不诊断心理疾病。
结论必须引用截图中可见的原始语言或用户提供的对话证据，不得把推测写成确定事实。
必须区分普通冲突和即时安全风险，安全判断始终优先于关系建议。
所有面向用户的可读文本必须使用简体中文，包括事件摘要、情绪、需求、模式、证据解释、安全说明、策略标题、消息内容、原因、风险和适用条件。
JSON 字段名和契约规定的枚举值保留英文，不要翻译。
只输出符合指定 JSON Schema 的 JSON，不要输出 Markdown、解释或中英双语。
`.trim();

export function timelinePrompt(
  request: AnalysisRequest,
  redaction: RedactionReport,
  supportsVision: boolean
): string {
  return `
关系类型：${request.relationshipType}
用户目标：${request.goal}

请根据对话和附图建立按时间排序的事件时间线，并保留用于证据引用的原始语句。
${
  request.imageDataUrl && supportsVision
    ? "当前请求包含聊天截图。请直接读取截图中可见的聊天内容、说话人和时间；不要猜测未出现的人名、账号或身份。"
    : "当前请求没有可用图片。只能使用对话文本，并把缺失信息写入 openQuestions。"
}
时间线可以完全来自截图，也可以来自文字记录，不需要用户同时提供两者。
每条事件的 summary、emotions、signal 必须使用简体中文；quote 必须保留截图中的原话。

对话文本：
${redaction.text || "[没有文字记录，请仅使用附图。]"}
`.trim();
}

export function dynamicsPrompt(
  request: AnalysisRequest,
  timeline: Timeline
): string {
  return `
关系类型：${request.relationshipType}
用户目标：${request.goal}
事件时间线：
${JSON.stringify(timeline)}

识别最可能的互动模式、双方可能的需求、升级循环、可观察触发点、盲区和证据引用，并给出校准后的置信度。
结论必须写成由原话支持的假设，不得使用英文输出可读内容。
primaryPattern、secondaryPatterns、emotionalNeeds、escalationCycle、triggers、blindSpots 和 evidenceQuotes 中的可读文本必须全部使用简体中文。
`.trim();
}

export function safetyPrompt(
  request: AnalysisRequest,
  redaction: RedactionReport,
  timeline: Timeline
): string {
  return `
关系类型：${request.relationshipType}
用户目标：${request.goal}
事件时间线：
${JSON.stringify(timeline)}
对话文本：
${redaction.text || "[只有截图，没有单独文字记录]"}

评估即时和近期安全风险。需要考虑自伤、他伤、威胁、暴力、胁迫、跟踪、隔离和极端控制。
不要把普通生气过度标记为虐待。如果风险为 high，应优先建议真人支持和紧急服务，而不是普通沟通话术。
rationale、flags 和 recommendedAction 必须使用简体中文。
`.trim();
}

export function strategyPrompt(
  request: AnalysisRequest,
  dynamics: Dynamics,
  safety: SafetyAssessment
): string {
  return `
关系类型：${request.relationshipType}
用户目标：${request.goal}
关系动态：
${JSON.stringify(dynamics)}
安全判断：
${JSON.stringify(safety)}

生成恰好三条不同且简洁的沟通策略。每条都包含 objective、可直接发送的 message、whyItWorks、risk、whenToUse、confidence 和 evidenceQuotes。
title、objective、message、whyItWorks、risk、whenToUse 和 evidenceQuotes 必须全部使用简体中文。
不能使用内疚操控、监视、威胁或强迫说服。安全风险为 medium 或 high 时，必须包含安全或边界优先的选项，不得鼓励对抗。
tone 和 id 按契约保留英文，其余可读内容只能使用简体中文。
`.trim();
}
