import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  EyeOff,
  FileText,
  FlaskConical,
  FolderOpen,
  Gauge,
  GitBranch,
  KeyRound,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  ScanText,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  Zap
} from "lucide-react";
import {
  analyzeCase,
  correctCaseEvent,
  deleteAllData,
  deleteCase,
  ensureSession,
  getCase,
  getCases,
  getHealth,
  getLatestEvaluation,
  runEvaluation,
  saveOutcome
} from "./api.ts";
import type {
  AnalysisRequest,
  AnalysisResult,
  CaseSummary,
  EvaluationReport,
  Goal,
  OutcomeRequest,
  RelationshipType
} from "../shared/contracts.ts";

type View = "workbench" | "cases" | "evaluation" | "system";
type ResultTab =
  | "conversation"
  | "timeline"
  | "dynamics"
  | "strategies"
  | "trace";

interface HealthState {
  service: string;
  version: string;
  provider: {
    mode: string;
    model: string;
    configured: boolean;
    keyMode: "none" | "server" | "byok";
    supportsVision: boolean;
  };
  privacy: {
    retentionDays: number;
    consentVersion: string;
    storage: "sqlite" | "postgres";
  };
  database: string;
}

interface UploadedImage {
  name: string;
  dataUrl: string;
}

const goalLabels: Record<Goal, string> = {
  be_understood: "让对方理解我",
  deescalate: "缓和冲突",
  set_boundary: "表达边界",
  apologize: "有效道歉",
  decide: "判断是否继续",
  safety: "安全优先"
};

const relationshipLabels: Record<RelationshipType, string> = {
  partner: "伴侣",
  friend: "朋友",
  roommate: "室友",
  family: "家人",
  coworker: "同事"
};

const toneLabels = {
  gentle: "温和",
  direct: "直接",
  boundary: "边界",
  repair: "修复",
  safety: "安全"
} as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function riskLabel(level: string): string {
  return (
    {
      none: "无明确风险",
      low: "低风险",
      medium: "中风险",
      high: "高风险"
    }[level] || level
  );
}

function statusLabel(status: string): string {
  return (
    {
      completed: "已完成",
      degraded: "降级完成",
      pending: "等待运行",
      failed: "失败"
    }[status] || status
  );
}

function MetricBar({
  label,
  value
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="metric-row">
      <div className="metric-label">
        <span>{label}</span>
        <strong>{Math.round(value * 100)}%</strong>
      </div>
      <div className="metric-track" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function Header({
  health,
  activeView,
  onViewChange
}: {
  health: HealthState | null;
  activeView: View;
  onViewChange: (view: View) => void;
}) {
  const navigation: Array<{
    id: View;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: "workbench", label: "分析工作台", icon: <BrainCircuit size={18} /> },
    { id: "cases", label: "案例库", icon: <Layers size={18} /> },
    { id: "evaluation", label: "评测中心", icon: <FlaskConical size={18} /> },
    { id: "system", label: "系统状态", icon: <Server size={18} /> }
  ];

  return (
    <header className="app-header">
      <div className="brand-block">
        <div className="brand-mark">
          <GitBranch size={19} />
        </div>
        <div>
          <strong>RelateLab</strong>
          <span>AI 关系工程工作台</span>
        </div>
      </div>

      <nav className="top-nav" aria-label="Primary navigation">
        {navigation.map((item) => (
          <button
            className={activeView === item.id ? "nav-item active" : "nav-item"}
            key={item.id}
            onClick={() => onViewChange(item.id)}
            type="button"
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="service-state">
        <span
          className={
            health?.provider.configured ? "status-dot online" : "status-dot warning"
          }
        />
        <div>
          <strong>{health?.provider.mode || "连接中"}</strong>
          <span>{health?.provider.model || "正在检查模型"}</span>
        </div>
      </div>
    </header>
  );
}

function Workbench({
  initialResult,
  keyMode,
  retentionDays,
  consentVersion,
  onCompleted,
  onReset
}: {
  initialResult: AnalysisResult | null;
  keyMode: "none" | "server" | "byok";
  retentionDays: number;
  consentVersion: string;
  onCompleted: (result: AnalysisResult) => void;
  onReset: () => void;
}) {
  const [title, setTitle] = useState("晚归与持续追问");
  const [goal, setGoal] = useState<Goal>("deescalate");
  const [relationshipType, setRelationshipType] =
    useState<RelationshipType>("partner");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>("conversation");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState(
    () => sessionStorage.getItem("relatelab.deepseek.key") || ""
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(
    () => sessionStorage.getItem("relatelab.consent") === consentVersion
  );
  const requiresUserKey = keyMode === "byok" || keyMode === "none";
  const canRun =
    images.length > 0 &&
    (!requiresUserKey || apiKey.trim().length > 0) &&
    consentAccepted;

  useEffect(() => {
    if (!initialResult) {
      return;
    }
    setTitle(initialResult.title);
    setGoal(initialResult.goal);
    setRelationshipType(initialResult.relationshipType);
    setImages([]);
    setResult(initialResult);
    setActiveTab("conversation");
    setError("");
  }, [initialResult]);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) {
      return;
    }
    const remaining = Math.max(0, 6 - images.length);
    for (const file of Array.from(files).slice(0, remaining)) {
      const reader = new FileReader();
      reader.onload = () => {
        setImages((current) =>
          current.length >= 6
            ? current
            : [
                ...current,
                {
                  name: file.name,
                  dataUrl: String(reader.result)
                }
              ]
        );
      };
      reader.readAsDataURL(file);
    }
  };

  const run = async () => {
    setIsRunning(true);
    setError("");
    try {
      const payload: AnalysisRequest = {
        title,
        goal,
        relationshipType,
        transcript: "",
        imageDataUrls: images.map((image) => image.dataUrl),
        consentAccepted,
        consentVersion
      };
      const output = await analyzeCase(payload, apiKey.trim() || undefined);
      setResult(output);
      setActiveTab("conversation");
      onCompleted(output);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "分析失败。"
      );
    } finally {
      setIsRunning(false);
    }
  };

  const correctEvent = async (
    eventId: string,
    correction: {
      quote: string;
      actor: "self" | "other" | "both" | "unknown";
      timestamp: string | null;
    }
  ) => {
    if (!result) {
      return;
    }
    const updated = await correctCaseEvent(result.caseId, eventId, correction);
    setResult(updated);
    onCompleted(updated);
  };

  const tabs: Array<{ id: ResultTab; label: string; count?: number }> = [
    {
      id: "conversation",
      label: "聊天记录",
      count: result?.timeline.events.length
    },
    { id: "timeline", label: "事件时间线", count: result?.timeline.events.length },
    { id: "dynamics", label: "关系动态" },
    { id: "strategies", label: "策略", count: result?.strategies.length },
    { id: "trace", label: "Agent 调用链", count: result?.trace.length }
  ];

  return (
    <div className="workbench-grid">
      <section className="input-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">案例输入</span>
            <h1>关系案例输入</h1>
          </div>
          <button
            className="icon-button"
            title="重置为示例"
            onClick={() => {
              setTitle("晚归与持续追问");
              setGoal("deescalate");
              setRelationshipType("partner");
              setImages([]);
              setResult(null);
              setError("");
              onReset();
            }}
            type="button"
          >
            <RefreshCw size={17} />
          </button>
        </div>

        <label className="field">
          <span>案例标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
          />
        </label>

        <section
          className={`key-settings ${
            requiresUserKey && !apiKey.trim() ? "missing" : ""
          }`}
        >
          <div className="key-settings-head">
            <KeyRound size={17} />
            <div>
              <strong>DeepSeek API Key</strong>
              <span>
                {keyMode === "server"
                  ? "当前由部署方提供，不会显示密钥内容"
                  : "仅保存在当前浏览器标签页"}
              </span>
            </div>
          </div>
          {keyMode === "server" ? null : (
            <div className="key-input-row">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => {
                  const value = event.target.value;
                  setApiKey(value);
                  if (value.trim()) {
                    sessionStorage.setItem("relatelab.deepseek.key", value);
                  } else {
                    sessionStorage.removeItem("relatelab.deepseek.key");
                  }
                }}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                title={showApiKey ? "隐藏 Key" : "显示 Key"}
                onClick={() => setShowApiKey((current) => !current)}
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          )}
          <small>
            分析时临时发送给后端调用 DeepSeek，不写入数据库、Trace 或运行日志。
          </small>
        </section>

        <label className="consent-row">
          <input
            type="checkbox"
            checked={consentAccepted}
            onChange={(event) => {
              const checked = event.target.checked;
              setConsentAccepted(checked);
              if (checked) {
                sessionStorage.setItem("relatelab.consent", consentVersion);
              } else {
                sessionStorage.removeItem("relatelab.consent");
              }
            }}
          />
          <div>
            <strong>
              我同意
              <a
                href="/privacy.html"
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                数据使用与隐私说明
              </a>
            </strong>
            <span>
              截图会发送给 DeepSeek；案例默认保留 {retentionDays} 天，可随时在系统状态中全部删除。
            </span>
          </div>
        </label>

        <div className="field-grid">
          <label className="field">
            <span>关系类型</span>
            <select
              value={relationshipType}
              onChange={(event) =>
                setRelationshipType(event.target.value as RelationshipType)
              }
            >
              {Object.entries(relationshipLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>当前目标</span>
            <select
              value={goal}
              onChange={(event) => setGoal(event.target.value as Goal)}
            >
              {Object.entries(goalLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span>聊天记录截图</span>
          <label className="upload-zone">
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => handleFiles(event.target.files)}
            />
            <Upload size={19} />
            <div>
              <strong>
                {images.length > 0
                  ? `已上传 ${images.length} 张截图`
                  : "上传聊天记录截图"}
              </strong>
              <span>最多 6 张，按上传顺序读取；无需手工输入对话文字</span>
            </div>
          </label>
          {images.length > 0 ? (
            <div className="upload-preview-grid">
              {images.map((image, index) => (
                <figure key={`${image.name}-${index}`}>
                  <img src={image.dataUrl} alt={`聊天记录截图 ${index + 1}`} />
                  <figcaption>
                    <span>{index + 1}</span>
                    <button
                      type="button"
                      title="移除截图"
                      onClick={() =>
                        setImages((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index)
                        )
                      }
                    >
                      <X size={13} />
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="inline-error">
            <AlertTriangle size={17} />
            <span>{error}</span>
          </div>
        ) : null}

        <button
          className="primary-button"
          type="button"
          onClick={run}
          disabled={isRunning || !canRun}
        >
          {isRunning ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
          {isRunning ? "正在执行 Agent 链路" : "运行分析"}
        </button>

        <div className="pipeline-note">
          <ScanText size={17} />
          <div>
            <strong>五阶段处理链路</strong>
            <span>截图识别 → 聊天回放 → 关系动态 → 安全判断 → 策略生成</span>
          </div>
        </div>
      </section>

      <section className="result-panel">
        {!result ? (
          <EmptyState
            icon={<BrainCircuit size={26} />}
            title="等待案例运行"
            detail="上传聊天截图后，AI 会直接重建聊天记录，并在每条消息下插入意图、需求和行动建议。"
          />
        ) : (
          <>
            <div className="result-heading">
              <div>
                <span className="eyebrow">分析结果</span>
                <h2>{result.title}</h2>
              </div>
              <span className={`risk-badge risk-${result.safety.riskLevel}`}>
                <ShieldCheck size={16} />
                {riskLabel(result.safety.riskLevel)}
              </span>
            </div>

            <div className="run-metrics">
              <div>
                <Clock size={16} />
                <span>耗时</span>
                <strong>{result.metrics.durationMs} ms</strong>
              </div>
              <div>
                <Zap size={16} />
                <span>Token</span>
                <strong>{result.metrics.totalTokens || "离线模式"}</strong>
              </div>
              <div>
                <Activity size={16} />
                <span>状态</span>
                <strong>{statusLabel(result.status)}</strong>
              </div>
              <div>
                <Database size={16} />
                <span>模型提供方</span>
                <strong>{result.provider.mode}</strong>
              </div>
            </div>

            {result.safety.riskLevel !== "none" ? (
              <div className={`safety-banner risk-${result.safety.riskLevel}`}>
                <AlertTriangle size={20} />
                <div>
                  <strong>{result.safety.flags.join("；") || "需要安全复核"}</strong>
                  <span>{result.safety.recommendedAction}</span>
                </div>
              </div>
            ) : null}

            <div className="result-tabs" role="tablist">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? "active" : ""}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                  {tab.count !== undefined ? <span>{tab.count}</span> : null}
                </button>
              ))}
            </div>

            <div className="result-content">
              {activeTab === "conversation" ? (
                <ConversationView result={result} onCorrectEvent={correctEvent} />
              ) : null}
              {activeTab === "timeline" ? (
                <TimelineView result={result} />
              ) : null}
              {activeTab === "dynamics" ? (
                <DynamicsView result={result} />
              ) : null}
              {activeTab === "strategies" ? (
                <StrategiesView
                  result={result}
                  onSaveOutcome={(strategyId, input) =>
                    saveOutcome(result.caseId, {
                      strategyId,
                      ...input
                    }).then(() => undefined)
                  }
                />
              ) : null}
              {activeTab === "trace" ? <TraceView result={result} /> : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function getEventGuidance(
  event: AnalysisResult["timeline"]["events"][number]
): string {
  if (event.signal.includes("指责")) {
    return "先问清对方最在意的那一个具体行为，不要急着证明自己是否有道理。";
  }
  if (event.signal.includes("撤退")) {
    return "停止连续追问，给出一个明确时间点，让对方知道什么时候继续沟通。";
  }
  if (event.signal.includes("需求表达")) {
    return "保留这句需求，再补一个对方能够直接执行的具体请求。";
  }
  if (event.signal.includes("修复")) {
    return "先承认这句话造成的影响，再说下一次准备改变什么行为。";
  }
  if (event.actor === "other") {
    return "先复述你理解到的信息，再询问对方最担心或最希望改变的是什么。";
  }
  return "把抽象判断换成一个具体时刻、影响和可执行请求。";
}

function ConversationView({
  result,
  onCorrectEvent
}: {
  result: AnalysisResult;
  onCorrectEvent: (
    eventId: string,
    correction: {
      quote: string;
      actor: "self" | "other" | "both" | "unknown";
      timestamp: string | null;
    }
  ) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftQuote, setDraftQuote] = useState("");
  const [draftActor, setDraftActor] =
    useState<"self" | "other" | "both" | "unknown">("unknown");
  const [draftTimestamp, setDraftTimestamp] = useState("");
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState("");

  return (
    <div className="conversation-view">
      <div className="conversation-summary">
        <BrainCircuit size={18} />
        <div>
          <strong>AI 已根据截图重建聊天记录</strong>
          <span>
            共识别 {result.timeline.events.length} 条消息；灰色区域是模型解读，不代表对方真实意图。
          </span>
        </div>
      </div>

      {result.timeline.events.map((event, index) => {
        const side =
          event.actor === "self"
            ? "self"
            : event.actor === "other"
              ? "other"
              : "unknown";
        const need = result.dynamics.emotionalNeeds.find(
          (item) => item.party === event.actor || item.party === "both"
        );
        const urgency =
          event.severity >= 0.75
            ? "高风险信号"
            : event.severity >= 0.45
              ? "需要留意"
              : "普通信息";

        return (
          <div className={`chat-row ${side}`} key={event.id}>
            <div className="chat-avatar">
              {side === "self" ? "我" : side === "other" ? "TA" : "?"}
            </div>
            <div className="chat-content">
              <div className="chat-meta">
                <span>{side === "self" ? "我" : side === "other" ? "对方" : "未标明"}</span>
                <span>{event.timestamp || `消息 ${index + 1}`}</span>
                <button
                  type="button"
                  className="correction-trigger"
                  onClick={() => {
                    setEditingId(event.id);
                    setDraftQuote(event.quote);
                    setDraftActor(event.actor);
                    setDraftTimestamp(event.timestamp || "");
                    setCorrectionError("");
                  }}
                >
                  修正
                </button>
              </div>
              {editingId === event.id ? (
                <div className="correction-editor">
                  <textarea
                    value={draftQuote}
                    onChange={(changeEvent) =>
                      setDraftQuote(changeEvent.target.value)
                    }
                  />
                  <div className="correction-fields">
                    <select
                      value={draftActor}
                      onChange={(changeEvent) =>
                        setDraftActor(
                          changeEvent.target.value as typeof draftActor
                        )
                      }
                    >
                      <option value="self">我</option>
                      <option value="other">对方</option>
                      <option value="both">双方</option>
                      <option value="unknown">未标明</option>
                    </select>
                    <input
                      value={draftTimestamp}
                      onChange={(changeEvent) =>
                        setDraftTimestamp(changeEvent.target.value)
                      }
                      placeholder="例如 21:10"
                    />
                  </div>
                  {correctionError ? (
                    <div className="correction-error">{correctionError}</div>
                  ) : null}
                  <div className="correction-actions">
                    <button
                      type="button"
                      className="primary-button compact"
                      disabled={savingCorrection || draftQuote.trim().length === 0}
                      onClick={() => {
                        setSavingCorrection(true);
                        setCorrectionError("");
                        void onCorrectEvent(event.id, {
                          quote: draftQuote.trim(),
                          actor: draftActor,
                          timestamp: draftTimestamp.trim() || null
                        })
                          .then(() => setEditingId(null))
                          .catch((error) =>
                            setCorrectionError(
                              error instanceof Error
                                ? error.message
                                : "保存修正失败。"
                            )
                          )
                          .finally(() => setSavingCorrection(false));
                      }}
                    >
                      {savingCorrection ? (
                        <Loader2 className="spin" size={15} />
                      ) : null}
                      保存修正
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setEditingId(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="chat-bubble">{event.quote}</div>
              )}

              <div
                className={`inline-ai-card ${
                  event.severity >= 0.75
                    ? "urgent"
                    : event.severity >= 0.45
                      ? "attention"
                      : ""
                }`}
              >
                <div className="inline-ai-head">
                  <BrainCircuit size={15} />
                  <strong>AI 解读</strong>
                  <span>{urgency}</span>
                </div>
                <p className="inline-ai-summary">
                  {event.interpretation || event.summary}
                </p>
                {event.need || need ? (
                  <p className="inline-ai-need">
                    <span>可能的深层需求</span>
                    {event.need || need?.need}
                  </p>
                ) : null}
                <div className="tag-row">
                  {event.emotions.map((emotion) => (
                    <span className="tag" key={emotion}>
                      {emotion}
                    </span>
                  ))}
                  <span className="tag">{event.signal}</span>
                </div>
                <div className="inline-ai-action">
                  <span>建议动作</span>
                  <p>{event.recommendedAction || getEventGuidance(event)}</p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineView({ result }: { result: AnalysisResult }) {
  return (
    <div className="timeline-list">
      {result.timeline.events.map((event, index) => (
        <article className="timeline-event" key={event.id}>
          <div className="timeline-index">{String(index + 1).padStart(2, "0")}</div>
          <div className="timeline-body">
            <div className="timeline-meta">
              <span className={`actor actor-${event.actor}`}>
                {event.actor === "self"
                  ? "用户"
                  : event.actor === "other"
                    ? "对方"
                    : "未标明"}
              </span>
              <span>{event.timestamp || "无时间戳"}</span>
              <span>{event.signal}</span>
            </div>
            <blockquote>{event.quote}</blockquote>
            <div className="tag-row">
              {event.emotions.map((emotion) => (
                <span className="tag" key={emotion}>
                  {emotion}
                </span>
              ))}
              <span className="severity">
                严重度 {Math.round(event.severity * 100)}
              </span>
            </div>
          </div>
        </article>
      ))}
      <div className="open-questions">
        <strong>仍需确认</strong>
        {result.timeline.openQuestions.map((question) => (
          <span key={question}>{question}</span>
        ))}
      </div>
    </div>
  );
}

function DynamicsView({ result }: { result: AnalysisResult }) {
  return (
    <div className="analysis-grid">
      <section className="analysis-section lead-section">
        <span className="eyebrow">主要模式</span>
        <h3>{result.dynamics.primaryPattern}</h3>
        <div className="confidence-line">
          <span>置信度 {Math.round(result.dynamics.confidence * 100)}%</span>
          <div className="mini-track">
            <span
              style={{ width: `${result.dynamics.confidence * 100}%` }}
            />
          </div>
        </div>
        <div className="tag-row">
          {result.dynamics.secondaryPatterns.map((pattern) => (
            <span className="tag" key={pattern}>
              {pattern}
            </span>
          ))}
        </div>
      </section>

      <section className="analysis-section">
        <h3>情绪需求</h3>
        <div className="need-list">
          {result.dynamics.emotionalNeeds.map((need) => (
            <div className="need-item" key={`${need.party}-${need.need}`}>
              <span>{need.party === "self" ? "用户" : need.party === "other" ? "对方" : "双方"}</span>
              <strong>{need.need}</strong>
              <blockquote>{need.evidence}</blockquote>
            </div>
          ))}
        </div>
      </section>

      <section className="analysis-section">
        <h3>升级循环</h3>
        <ol className="cycle-list">
          {result.dynamics.escalationCycle.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="analysis-section">
        <h3>触发点与盲区</h3>
        <div className="two-column-list">
          <div>
            <span>触发点</span>
            {result.dynamics.triggers.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
          <div>
            <span>盲区</span>
            {result.dynamics.blindSpots.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function StrategiesView({
  result,
  onSaveOutcome
}: {
  result: AnalysisResult;
  onSaveOutcome: (
    strategyId: string,
    input: Omit<OutcomeRequest, "strategyId">
  ) => Promise<void>;
}) {
  return (
    <div className="strategy-list">
      {result.strategies.map((strategy, index) => (
        <article className="strategy-card" key={strategy.id}>
          <div className="strategy-head">
            <div className="strategy-number">{index + 1}</div>
            <div>
              <span className={`tone tone-${strategy.tone}`}>
                {toneLabels[strategy.tone]}
              </span>
              <h3>{strategy.title}</h3>
            </div>
            <div className="strategy-confidence">
              <span>置信度</span>
              <strong>{Math.round(strategy.confidence * 100)}%</strong>
            </div>
          </div>
          <p className="strategy-objective">{strategy.objective}</p>
          <div className="message-preview">{strategy.message}</div>
          <div className="strategy-detail-grid">
            <div>
              <span>有效原因</span>
              <p>{strategy.whyItWorks}</p>
            </div>
            <div>
              <span>风险</span>
              <p>{strategy.risk}</p>
            </div>
            <div>
              <span>适用条件</span>
              <p>{strategy.whenToUse}</p>
            </div>
          </div>
          <div className="evidence-strip">
            {strategy.evidenceQuotes.map((quote) => (
              <span key={quote}>{quote}</span>
            ))}
          </div>
          <StrategyOutcomeForm
            strategyId={strategy.id}
            onSave={onSaveOutcome}
          />
        </article>
      ))}
    </div>
  );
}

function StrategyOutcomeForm({
  strategyId,
  onSave
}: {
  strategyId: string;
  onSave: (
    strategyId: string,
    input: Omit<OutcomeRequest, "strategyId">
  ) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [adopted, setAdopted] = useState(true);
  const [responseTone, setResponseTone] =
    useState<OutcomeRequest["responseTone"]>("not_sent");
  const [conflictChange, setConflictChange] =
    useState<OutcomeRequest["conflictChange"]>("unknown");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  if (!expanded) {
    return (
      <div className="outcome-summary">
        {saved ? <span>结果已记录</span> : <span>实际使用后可以回填结果</span>}
        <button type="button" onClick={() => setExpanded(true)}>
          记录结果
        </button>
      </div>
    );
  }

  return (
    <div className="outcome-form">
      <div className="outcome-choice">
        <span>是否采用</span>
        <button
          type="button"
          className={adopted ? "active" : ""}
          onClick={() => setAdopted(true)}
        >
          采用
        </button>
        <button
          type="button"
          className={!adopted ? "active" : ""}
          onClick={() => setAdopted(false)}
        >
          未采用
        </button>
      </div>
      <label>
        <span>对方回应</span>
        <select
          value={responseTone}
          onChange={(event) =>
            setResponseTone(event.target.value as OutcomeRequest["responseTone"])
          }
        >
          <option value="not_sent">还没有发送</option>
          <option value="improved">有积极回应</option>
          <option value="neutral">回应一般</option>
          <option value="worsened">回应更差</option>
          <option value="no_response">没有回应</option>
        </select>
      </label>
      <label>
        <span>冲突变化</span>
        <select
          value={conflictChange}
          onChange={(event) =>
            setConflictChange(
              event.target.value as OutcomeRequest["conflictChange"]
            )
          }
        >
          <option value="unknown">不确定</option>
          <option value="improved">有所缓和</option>
          <option value="unchanged">没有变化</option>
          <option value="worsened">进一步恶化</option>
        </select>
      </label>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="可选：记录实际发生了什么"
        maxLength={1000}
      />
      {error ? <div className="correction-error">{error}</div> : null}
      <div className="correction-actions">
        <button
          className="primary-button compact"
          type="button"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            setError("");
            void onSave(strategyId, {
              adopted,
              responseTone,
              conflictChange,
              notes
            })
              .then(() => {
                setSaved(true);
                setExpanded(false);
              })
              .catch((saveError) =>
                setError(
                  saveError instanceof Error
                    ? saveError.message
                    : "保存结果失败。"
                )
              )
              .finally(() => setSaving(false));
          }}
        >
          {saving ? <Loader2 className="spin" size={15} /> : null}
          保存结果
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setExpanded(false)}
        >
          取消
        </button>
      </div>
    </div>
  );
}

function TraceView({ result }: { result: AnalysisResult }) {
  return (
    <div className="trace-wrap">
      <table className="trace-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>状态</th>
            <th>模型提供方</th>
            <th>耗时</th>
            <th>Token</th>
            <th>输出摘要</th>
          </tr>
        </thead>
        <tbody>
          {result.trace.map((step) => (
            <tr key={step.id}>
              <td>
                <strong>{step.agent}</strong>
                <span>{step.inputSummary}</span>
              </td>
              <td>
                <span className={`trace-status ${step.status}`}>
                  {statusLabel(step.status)}
                </span>
              </td>
              <td>
                <strong>{step.provider}</strong>
                <span>{step.model}</span>
              </td>
              <td>{step.durationMs} ms</td>
              <td>{step.usage?.totalTokens || "-"}</td>
              <td>{step.outputSummary}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.warnings.length > 0 ? (
        <div className="warning-list">
          <strong>运行警告</strong>
          {result.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CasesView({
  cases,
  loading,
  openingId,
  deletingId,
  error,
  onRefresh,
  onOpen,
  onDelete
}: {
  cases: CaseSummary[];
  loading: boolean;
  openingId: string;
  deletingId: string;
  error: string;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <span className="eyebrow">案例记录</span>
          <h1>案例库</h1>
        </div>
        <button className="secondary-button" type="button" onClick={onRefresh}>
          <RefreshCw size={17} className={loading ? "spin" : ""} />
          刷新
        </button>
      </div>

      {error ? (
        <div className="inline-error case-error">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      ) : null}

      {cases.length === 0 ? (
        <EmptyState
          icon={<FileText size={26} />}
          title="暂无已运行案例"
          detail="从分析工作台运行一个案例后，运行状态和风险等级会出现在这里。"
        />
      ) : (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>案例</th>
                <th>关系</th>
                <th>目标</th>
                <th>状态</th>
                <th>风险</th>
                <th>耗时</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <span>{item.id.slice(0, 8)}</span>
                  </td>
                  <td>{relationshipLabels[item.relationshipType]}</td>
                  <td>{goalLabels[item.goal]}</td>
                  <td>
                    <span className={`table-status ${item.status}`}>
                      {statusLabel(item.status)}
                    </span>
                  </td>
                  <td>{riskLabel(item.riskLevel || "none")}</td>
                  <td>{item.durationMs === null ? "-" : `${item.durationMs} ms`}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="table-action"
                        type="button"
                        title="打开历史案例"
                        onClick={() => onOpen(item.id)}
                        disabled={Boolean(openingId)}
                      >
                        {openingId === item.id ? (
                          <Loader2 className="spin" size={14} />
                        ) : (
                          <FolderOpen size={14} />
                        )}
                        打开
                      </button>
                      {pendingDeleteId === item.id ? (
                        <>
                          <button
                            className="table-action danger"
                            type="button"
                            disabled={Boolean(deletingId)}
                            onClick={() => {
                              void onDelete(item.id).finally(() =>
                                setPendingDeleteId(null)
                              );
                            }}
                          >
                            {deletingId === item.id ? (
                              <Loader2 className="spin" size={14} />
                            ) : (
                              <Trash2 size={14} />
                            )}
                            确认
                          </button>
                          <button
                            className="table-action icon-only"
                            type="button"
                            title="取消删除"
                            onClick={() => setPendingDeleteId(null)}
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <button
                          className="table-action danger"
                          type="button"
                          title="删除案例"
                          onClick={() => setPendingDeleteId(item.id)}
                        >
                          <Trash2 size={14} />
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EvaluationView({
  report,
  running,
  error,
  onRun
}: {
  report: EvaluationReport | null;
  running: boolean;
  error: string;
  onRun: () => void;
}) {
  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <span className="eyebrow">评测流水线</span>
          <h1>评测中心</h1>
        </div>
        <button
          className="primary-button compact"
          type="button"
          onClick={onRun}
          disabled={running}
        >
          {running ? <Loader2 className="spin" size={17} /> : <FlaskConical size={17} />}
          {running ? "运行评测" : "执行评测集"}
        </button>
      </div>

      {error ? (
        <div className="inline-error evaluation-error">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      ) : null}

      {!report ? (
        <EmptyState
          icon={<BarChart3 size={26} />}
          title="尚无评测报告"
          detail="执行内置评测集后，将得到结构化输出、安全性、证据引用、策略多样性和脱敏覆盖率。"
        />
      ) : (
        <div className="evaluation-layout">
          <div className="evaluation-summary">
            <div className="score-hero">
              <span>平均得分</span>
              <strong>{Math.round(report.averageScore * 100)}</strong>
              <small>/ 100</small>
            </div>
            <div className="summary-stats">
              <div>
                <span>通过案例</span>
                <strong>
                  {report.passedCases}/{report.totalCases}
                </strong>
              </div>
              <div>
                <span>数据集版本</span>
                <strong>{report.datasetVersion}</strong>
              </div>
              <div>
                <span>模型提供方</span>
                <strong>{report.providerMode}</strong>
              </div>
            </div>
          </div>

          <section className="metrics-panel">
            <h3>质量指标</h3>
            <MetricBar label="结构契约通过率" value={report.metrics.schemaValidity} />
            <MetricBar label="安全分级匹配" value={report.metrics.safetyMatch} />
            <MetricBar label="证据引用覆盖" value={report.metrics.evidenceCoverage} />
            <MetricBar label="策略多样性" value={report.metrics.strategyDiversity} />
            <MetricBar label="隐私脱敏覆盖" value={report.metrics.redactionCoverage} />
          </section>

          <section className="evaluation-cases">
            <h3>案例结果</h3>
            {report.results.map((result) => (
              <article className="evaluation-case" key={result.caseId}>
                <div>
                  <strong>{result.caseId}</strong>
                  <span>得分 {Math.round(result.score * 100)}</span>
                </div>
                <div className="check-row">
                  {result.checks.map((check) => (
                    <span
                      className={check.passed ? "check-pass" : "check-fail"}
                      title={check.detail}
                      key={check.name}
                    >
                      {check.passed ? <CheckCircle2 size={14} /> : <X size={14} />}
                      {check.name}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </section>
        </div>
      )}
    </section>
  );
}

function SystemView({
  health,
  deletingData,
  onDeleteAllData
}: {
  health: HealthState | null;
  deletingData: boolean;
  onDeleteAllData: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const modules = [
    {
      icon: <ScanText size={19} />,
      title: "多模态输入",
      detail: "文本、聊天截图、脱敏和证据归一化"
    },
    {
      icon: <BrainCircuit size={19} />,
      title: "Agent 编排器",
      detail: "时间线、动态、安全、策略四阶段状态机"
    },
    {
      icon: <Database size={19} />,
      title: "案例持久化",
      detail: "SQLite 运行记录、结果快照和请求审计"
    },
    {
      icon: <ShieldCheck size={19} />,
      title: "安全护栏",
      detail: "规则安全层与模型安全判断合并"
    },
    {
      icon: <FlaskConical size={19} />,
      title: "评测系统",
      detail: "版本化评测集与五类质量指标"
    },
    {
      icon: <Gauge size={19} />,
      title: "可观测性",
      detail: "延迟、Token、降级、错误和逐步输出摘要"
    }
  ];

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <span className="eyebrow">平台状态</span>
          <h1>系统状态</h1>
        </div>
        <span className="health-pill">
          <span className="status-dot online" />
          {health ? "API 在线" : "API 不可用"}
        </span>
      </div>

      <div className="system-grid">
        <section className="system-summary">
          <h3>运行环境</h3>
          <dl>
            <div>
              <dt>服务</dt>
              <dd>{health?.service || "-"}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{health?.version || "-"}</dd>
            </div>
            <div>
              <dt>模型提供方</dt>
              <dd>{health?.provider.mode || "-"}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{health?.provider.model || "-"}</dd>
            </div>
            <div>
              <dt>密钥模式</dt>
              <dd>
                {health?.provider.keyMode === "byok"
                  ? "用户自带 Key"
                  : health?.provider.keyMode === "server"
                    ? "服务端托管"
                    : "未配置"}
              </dd>
            </div>
            <div>
              <dt>视觉输入</dt>
              <dd>{health?.provider.supportsVision ? "已启用" : "未启用"}</dd>
            </div>
            <div>
              <dt>数据存储</dt>
              <dd>{health?.database || "-"}</dd>
            </div>
            <div>
              <dt>保留期限</dt>
              <dd>
                {health?.privacy.retentionDays
                  ? `${health.privacy.retentionDays} 天`
                  : "-"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="module-grid">
          {modules.map((module) => (
            <article className="system-module" key={module.title}>
              <div className="module-icon">{module.icon}</div>
              <strong>{module.title}</strong>
              <span>{module.detail}</span>
            </article>
          ))}
        </section>
      </div>

      <section className="privacy-band">
        <div>
          <ShieldCheck size={20} />
          <div>
            <strong>隐私与数据控制</strong>
            <span>
              截图与原始 Key 不会写入案例库；分析结果按保留期限自动清理。
            </span>
          </div>
        </div>
        {confirmDelete ? (
          <div className="danger-actions">
            <button
              className="danger-button"
              type="button"
              disabled={deletingData}
              onClick={() => {
                onDeleteAllData();
                setConfirmDelete(false);
              }}
            >
              {deletingData ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Trash2 size={16} />
              )}
              确认删除全部数据
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            className="danger-button"
            type="button"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} />
            删除我的全部数据
          </button>
        )}
      </section>

      <section className="architecture-band">
        <div className="architecture-title">
          <span className="eyebrow">运行拓扑</span>
          <h3>请求执行路径</h3>
        </div>
        <div className="architecture-flow">
          {[
            "React 工作台",
            "Fastify API",
            "隐私脱敏",
            "Agent 状态机",
            "模型网关",
            "SQLite + 评测"
          ].map((item, index) => (
            <div className="architecture-node" key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item}</strong>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

export function App() {
  const [activeView, setActiveView] = useState<View>("workbench");
  const [health, setHealth] = useState<HealthState | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationReport | null>(null);
  const [casesLoading, setCasesLoading] = useState(false);
  const [openingCaseId, setOpeningCaseId] = useState("");
  const [deletingCaseId, setDeletingCaseId] = useState("");
  const [caseError, setCaseError] = useState("");
  const [loadedResult, setLoadedResult] = useState<AnalysisResult | null>(null);
  const [evaluationRunning, setEvaluationRunning] = useState(false);
  const [evaluationError, setEvaluationError] = useState("");
  const [deletingData, setDeletingData] = useState(false);

  const refreshCases = useCallback(async () => {
    setCasesLoading(true);
    try {
      setCases(await getCases());
    } finally {
      setCasesLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await ensureSession();
      await Promise.allSettled([
        getHealth().then(setHealth),
        getLatestEvaluation().then(setEvaluation),
        refreshCases()
      ]);
    })();
  }, [refreshCases]);

  const handleEvaluation = async () => {
    setEvaluationRunning(true);
    setEvaluationError("");
    try {
      setEvaluation(await runEvaluation());
    } catch (error) {
      setEvaluationError(
        error instanceof Error ? error.message : "评测失败。"
      );
    } finally {
      setEvaluationRunning(false);
    }
  };

  const handleCaseOpen = async (id: string) => {
    setOpeningCaseId(id);
    setCaseError("");
    try {
      setLoadedResult(await getCase(id));
      setActiveView("workbench");
    } catch (error) {
      setCaseError(
        error instanceof Error ? error.message : "加载案例失败。"
      );
    } finally {
      setOpeningCaseId("");
    }
  };

  const handleCaseDelete = async (id: string) => {
    setDeletingCaseId(id);
    setCaseError("");
    try {
      await deleteCase(id);
      if (loadedResult?.caseId === id) {
        setLoadedResult(null);
      }
      await refreshCases();
    } catch (error) {
      setCaseError(
        error instanceof Error ? error.message : "删除案例失败。"
      );
    } finally {
      setDeletingCaseId("");
    }
  };

  const handleDeleteAllData = async () => {
    setDeletingData(true);
    setCaseError("");
    try {
      await deleteAllData();
      setLoadedResult(null);
      setCases([]);
      setEvaluation(null);
    } catch (error) {
      setCaseError(
        error instanceof Error ? error.message : "删除数据失败。"
      );
    } finally {
      setDeletingData(false);
    }
  };

  const activeContent = useMemo(() => {
    if (activeView === "workbench") {
      return (
        <Workbench
          initialResult={loadedResult}
          keyMode={health?.provider.keyMode || "none"}
          retentionDays={health?.privacy.retentionDays || 30}
          consentVersion={health?.privacy.consentVersion || "2026-09-22"}
          onCompleted={(result) => {
            setLoadedResult(result);
            void refreshCases();
          }}
          onReset={() => setLoadedResult(null)}
        />
      );
    }
    if (activeView === "cases") {
      return (
        <CasesView
          cases={cases}
          loading={casesLoading}
          openingId={openingCaseId}
          deletingId={deletingCaseId}
          error={caseError}
          onRefresh={() => void refreshCases()}
          onOpen={(id) => void handleCaseOpen(id)}
          onDelete={handleCaseDelete}
        />
      );
    }
    if (activeView === "evaluation") {
      return (
        <EvaluationView
          report={evaluation}
          running={evaluationRunning}
          error={evaluationError}
          onRun={() => void handleEvaluation()}
        />
      );
    }
    return (
      <SystemView
        health={health}
        deletingData={deletingData}
        onDeleteAllData={() => void handleDeleteAllData()}
      />
    );
  }, [
    activeView,
    cases,
    casesLoading,
    caseError,
    deletingCaseId,
    deletingData,
    evaluation,
    evaluationError,
    evaluationRunning,
    health,
    loadedResult,
    openingCaseId,
    refreshCases
  ]);

  return (
    <div className="app-shell">
      <Header
        health={health}
        activeView={activeView}
        onViewChange={setActiveView}
      />
      <main className="app-main">{activeContent}</main>
    </div>
  );
}
