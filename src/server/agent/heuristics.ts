import type {
  Dynamics,
  Goal,
  RedactionReport,
  RelationshipEvent,
  SafetyAssessment,
  Strategy,
  Timeline
} from "../../shared/contracts.ts";

const emotionRules: Array<{ emotion: string; pattern: RegExp }> = [
  { emotion: "委屈", pattern: /(凭什么|你有没有想过|只有我|总是我|没人管)/ },
  { emotion: "失望", pattern: /(失望|算了|没用|你根本|从来不|每次都)/ },
  { emotion: "焦虑", pattern: /(担心|害怕|不安|你是不是|为什么不回|到底)/ },
  { emotion: "愤怒", pattern: /(生气|烦|滚|闭嘴|受够|你凭什么)/ },
  { emotion: "内疚", pattern: /(对不起|怪我|都是我的错|我没做好)/ },
  { emotion: "疲惫", pattern: /(累|随便|不想说|没力气|算了)/ },
  { emotion: "期待", pattern: /(我希望|我想要|能不能|可不可以|需要)/ },
  { emotion: "防御", pattern: /(不是我的问题|你又|我只是|没办法|工作而已)/ }
];

const safetyPatterns = {
  high:
    /(自杀|不想活|活着没意思|去死|杀了你|打死你|弄死你|伤害自己|同归于尽)/,
  medium: /(滚|闭嘴|废物|没用的东西|威胁|监控|跟踪|不准出门|别联系|让你好看)/,
  low: /(分手|离婚|拉黑|再也不见|彻底结束)/
};

function detectEmotions(text: string): string[] {
  const emotions = emotionRules
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.emotion);
  return emotions.length > 0 ? emotions.slice(0, 3) : ["未被明确表达"];
}

function detectSignal(text: string): string {
  if (/(你总是|你从来|每次|根本|凭什么)/.test(text)) {
    return "指责或绝对化表达";
  }
  if (/(随便|算了|没事|不想说|无所谓)/.test(text)) {
    return "撤退或抑制表达";
  }
  if (/(对不起|抱歉|是我不好)/.test(text)) {
    return "修复尝试";
  }
  if (/(我需要|我希望|能不能|可不可以)/.test(text)) {
    return "需求表达";
  }
  if (/(但是|可是|不是)/.test(text)) {
    return "防御或反驳";
  }
  return "信息陈述";
}

function lineSeverity(text: string): number {
  if (safetyPatterns.high.test(text)) {
    return 0.95;
  }
  if (safetyPatterns.medium.test(text)) {
    return 0.68;
  }
  if (/(你总是|你从来|每次都|根本|凭什么|闭嘴)/.test(text)) {
    return 0.48;
  }
  return 0.2;
}

export function parseTimeline(rawTranscript: string): Timeline {
  const lines = rawTranscript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const events: RelationshipEvent[] = lines.map((line, index) => {
    const parsed = line.match(
      /^(?:\[(?<bracketTimestamp>[^\]]+)\]\s*)?(?<actor>我|对方|自己|他|她|TA|A|B|Self|Other)(?:\s+(?<inlineTimestamp>\d{1,2}:\d{2}))?\s*[:：]?\s*(?<text>.+)$/i
    );

    const actorText = parsed?.groups?.actor?.toLowerCase() || "";
    const actor: RelationshipEvent["actor"] =
      actorText === "我" || actorText === "自己" || actorText === "self"
        ? "self"
        : actorText
          ? "other"
          : "unknown";

    const quote = parsed?.groups?.text?.trim() || line;
    const timestamp =
      parsed?.groups?.bracketTimestamp?.trim() ||
      parsed?.groups?.inlineTimestamp?.trim() ||
      null;

    return {
      id: `event-${index + 1}`,
      timestamp,
      actor,
      summary: `${actor === "self" ? "用户" : actor === "other" ? "对方" : "未标明角色"}表达了一条关系信号`,
      quote,
      emotions: detectEmotions(quote),
      signal: detectSignal(quote),
      severity: lineSeverity(quote)
    };
  });

  return {
    events,
    openQuestions: [
      "双方在这次对话前是否已经有过类似冲突？",
      "用户希望对方具体改变哪一个可观察行为？",
      "当前对话中是否存在未说出口的安全或边界问题？"
    ]
  };
}

function firstQuote(events: RelationshipEvent[], pattern: RegExp): string {
  return events.find((event) => pattern.test(event.quote))?.quote || "";
}

export function analyzeDynamics(timeline: Timeline): Dynamics {
  const events = timeline.events;
  const selfEvents = events.filter((event) => event.actor === "self");
  const otherEvents = events.filter((event) => event.actor === "other");
  const selfBlame = selfEvents.some((event) =>
    /(你总是|你从来|每次都|凭什么|为什么不能)/.test(event.quote)
  );
  const selfWithdraw = selfEvents.some((event) =>
    /(算了|随便|不想说)/.test(event.quote)
  );
  const otherBlame = otherEvents.some((event) =>
    /(你总是|你从来|每次都|凭什么|不是我的问题)/.test(event.quote)
  );
  const otherWithdraw = otherEvents.some((event) =>
    /(算了|随便|不想说|没什么好说)/.test(event.quote)
  );

  let primaryPattern = "需求表达不完整";
  const secondaryPatterns: string[] = [];

  if ((selfBlame || selfEvents.length > otherEvents.length) && otherWithdraw) {
    primaryPattern = "要求与撤退循环";
    secondaryPatterns.push("一方持续确认，一方通过缩短回应来降压");
  } else if (otherBlame && selfWithdraw) {
    primaryPattern = "指责与撤退循环";
    secondaryPatterns.push("冲突中的要求被感知为攻击");
  } else if (selfBlame && otherBlame) {
    primaryPattern = "指责与防御循环";
    secondaryPatterns.push("双方都在证明责任归属，真实需求被遮蔽");
  } else if (/(分手|离婚|拉黑)/.test(events.map((event) => event.quote).join(" "))) {
    primaryPattern = "关系稳定性威胁";
    secondaryPatterns.push("退出关系被用作冲突中的压力信号");
  }

  const quoteAll = events.map((event) => event.quote).join(" ");
  if (/(晚|回消息|电话|见面|时间)/.test(quoteAll)) {
    secondaryPatterns.push("可预期性和回应速度是主要触发点");
  }
  if (/(工作|忙|累)/.test(quoteAll)) {
    secondaryPatterns.push("压力来源可能与时间与精力分配有关");
  }

  const emotionalNeeds: Dynamics["emotionalNeeds"] = [];
  if (selfEvents.some((event) => /(为什么|到底|担心|提前告诉)/.test(event.quote))) {
    emotionalNeeds.push({
      party: "self",
      need: "获得可预期的回应与确定性",
      evidence:
        firstQuote(
          selfEvents,
          /(为什么|到底|担心|提前告诉)/
        ) || selfEvents[0]?.quote || ""
    });
  }
  if (otherEvents.some((event) => /(工作|忙|累|不是我能控制)/.test(event.quote))) {
    emotionalNeeds.push({
      party: "other",
      need: "减少被审问感并保留自主空间",
      evidence:
        firstQuote(
          otherEvents,
          /(工作|忙|累|不是我能控制)/
        ) || otherEvents[0]?.quote || ""
    });
  }

  if (emotionalNeeds.length === 0) {
    emotionalNeeds.push({
      party: "both",
      need: "在表达立场前先确认彼此的真实担忧",
      evidence: events[0]?.quote || "当前材料有限"
    });
  }

  const selectedEvidence = events
    .filter((event) => event.severity >= 0.4 || event.signal === "需求表达")
    .map((event) => event.quote)
    .slice(0, 5);

  return {
    primaryPattern,
    secondaryPatterns:
      secondaryPatterns.length > 0
        ? secondaryPatterns
        : ["当前材料不足以判断稳定模式"],
    emotionalNeeds,
    escalationCycle: [
      "一方通过追问或指责寻求确认",
      "另一方感到压力并缩短回应",
      "回应减少被理解为不在乎",
      "追问升级，双方开始讨论谁更有道理",
      "真实需求退到冲突后台"
    ],
    triggers: [
      /(晚|回消息|时间)/.test(quoteAll) ? "回应速度和日程变化" : "不确定的事件信息",
      /(工作|忙|累)/.test(quoteAll) ? "工作压力与精力不足" : "双方对事件重要性的判断不同"
    ],
    blindSpots: [
      "把表达需求等同于指责对方",
      "用退出对话来降低当下压力",
      "只讨论事件经过，没有说出希望下一次怎样做"
    ],
    evidenceQuotes:
      selectedEvidence.length > 0
        ? selectedEvidence
        : events.slice(0, 3).map((event) => event.quote),
    confidence: Math.min(0.88, 0.48 + events.length * 0.045)
  };
}

function riskRank(level: SafetyAssessment["riskLevel"]): number {
  return { none: 0, low: 1, medium: 2, high: 3 }[level];
}

export function mergeSafety(
  first: SafetyAssessment,
  second: SafetyAssessment
): SafetyAssessment {
  return riskRank(first.riskLevel) >= riskRank(second.riskLevel) ? first : second;
}

export function assessSafety(rawText: string): SafetyAssessment {
  if (safetyPatterns.high.test(rawText)) {
    return {
      riskLevel: "high",
      flags: ["自伤、他伤或极端失控表达"],
      rationale: "文本包含需要优先处理的直接安全信号。",
      recommendedAction:
        "暂停普通关系建议。优先确认当事人当前是否处于立即危险；如有立即危险，请联系 110、120 或当地心理援助热线 12356，并联系可信任的人陪同。"
    };
  }

  if (safetyPatterns.medium.test(rawText)) {
    return {
      riskLevel: "medium",
      flags: ["侮辱、威胁或控制性表达"],
      rationale: "文本中存在可能导致关系进一步失控的语言，但未发现明确的即时身体危险。",
      recommendedAction:
        "先建立边界并停止在情绪高点继续争论；如果出现威胁、跟踪或人身控制，保留证据并寻求可信第三方帮助。"
    };
  }

  if (safetyPatterns.low.test(rawText)) {
    return {
      riskLevel: "low",
      flags: ["关系退出威胁"],
      rationale: "文本出现关系退出信号，需要避免在高压下做不可逆决定。",
      recommendedAction:
        "先区分真实决定和情绪中的威胁表达，再约定一个更稳定的时间讨论具体改变。"
    };
  }

  return {
    riskLevel: "none",
    flags: [],
    rationale: "未发现明确的威胁、自伤或控制性安全信号。",
    recommendedAction: "可以进入普通沟通策略生成。"
  };
}

function messagesForGoal(goal: Goal, primaryPattern: string): Strategy[] {
  const commonEvidence: string[] = [];

  if (goal === "deescalate") {
    return [
      {
        id: "strategy-1",
        title: "先停止争论中的输赢",
        tone: "repair",
        objective: "降低防御，让双方从争论责任回到各自感受。",
        message:
          "我不想继续证明谁更有道理了。刚才我说话很急，是因为我担心这件事对我们不重要。我们先停十分钟，之后再谈下一次遇到类似情况可以直接怎么做，好吗？",
        whyItWorks: "先撤掉指责，再说明担心，给双方一个可执行的暂停机制。",
        risk: "如果对方把暂停理解为冷处理，可能暂时更不安。",
        whenToUse: "双方都在重复立场、对话已经明显升级时。",
        confidence: 0.81,
        evidenceQuotes: commonEvidence
      },
      {
        id: "strategy-2",
        title: "只讲一个具体时刻",
        tone: "gentle",
        objective: "把泛化指责压缩为一个可理解的事件。",
        message:
          "我卡住的是昨天晚上没有收到消息的那段时间。我那时很焦虑，但我没有说清楚，只变成了质问。下次如果你忙，能不能提前发一句大概什么时候方便联系？",
        whyItWorks: "具体事件比“你总是”更容易被回应，也提出了低成本的替代行为。",
        risk: "对方可能先解释忙碌原因，而不是马上回应需求。",
        whenToUse: `主要模式是“${primaryPattern}”，但仍有协商空间时。`,
        confidence: 0.78,
        evidenceQuotes: commonEvidence
      },
      {
        id: "strategy-3",
        title: "约定冲突暂停词",
        tone: "direct",
        objective: "建立双方都能识别的降级信号。",
        message:
          "我们一急就会不断追问和反驳。以后任何一方说“我需要缓一下”，就暂停二十分钟，但要在今晚之前说清楚什么时候继续。这样可以吗？",
        whyItWorks: "暂停有明确时限，减少把撤退解释为失联。",
        risk: "关系信任很低时，对方可能不遵守约定。",
        whenToUse: "双方愿意保留关系，但需要新的沟通规则时。",
        confidence: 0.74,
        evidenceQuotes: commonEvidence
      }
    ];
  }

  if (goal === "set_boundary") {
    return [
      {
        id: "strategy-1",
        title: "描述行为与影响",
        tone: "boundary",
        objective: "明确不可接受的沟通方式，同时不扩大指控。",
        message:
          "当你说“闭嘴”或直接结束对话时，我会感到被羞辱，也无法继续解决问题。我可以讨论分歧，但不会在辱骂中继续。等我们能不用这些话时，我再继续谈。",
        whyItWorks: "边界指向可观察行为和后续条件，不要求对方先承认动机。",
        risk: "对方可能指责你冷淡，需要保持边界而不进入争辩。",
        whenToUse: "出现侮辱、吼叫或持续打断时。",
        confidence: 0.86,
        evidenceQuotes: commonEvidence
      },
      {
        id: "strategy-2",
        title: "把边界写成选择",
        tone: "direct",
        objective: "说明自己会如何行动，而不是要求对方必须改变。",
        message:
          "我愿意继续沟通，但如果对话再次变成威胁或辱骂，我会结束这次谈话，并在双方冷静后另外约时间。这不是惩罚，是我保护自己继续沟通能力的边界。",
        whyItWorks: "把控制点放回自己，减少无效的权力争夺。",
        risk: "边界必须被执行，否则会削弱后续可信度。",
        whenToUse: "已经多次重复同一边界但行为未改变时。",
        confidence: 0.82,
        evidenceQuotes: commonEvidence
      },
      {
        id: "strategy-3",
        title: "先确认安全条件",
        tone: "safety",
        objective: "在关系沟通前先判断是否存在现实安全风险。",
        message:
          "我需要先确认一件事：如果继续谈会涉及威胁、跟踪或人身安全，我不会单独处理。我会先联系可信任的人，并在必要时寻求专业帮助。",
        whyItWorks: "把安全问题从普通沟通问题中分离。",
        risk: "如果当前环境不安全，发送长消息可能不是最佳做法。",
        whenToUse: "存在威胁、控制、跟踪或暴力风险时。",
        confidence: 0.9,
        evidenceQuotes: commonEvidence
      }
    ];
  }

  if (goal === "apologize") {
    return [
      {
        id: "strategy-1",
        title: "承认影响，不附带辩解",
        tone: "repair",
        objective: "让对方先确认自己的感受被看见。",
        message:
          "我看到了，我当时的回应让你觉得被否定。我不想先解释自己的动机，只想先承认这个影响是真实的。对不起。",
        whyItWorks: "先修复影响，避免用“但是我没有那个意思”抵消道歉。",
        risk: "如果过去重复发生，单次道歉可能不足以恢复信任。",
        whenToUse: "对方主要在表达受伤，而不是要求事实判断时。",
        confidence: 0.84,
        evidenceQuotes: commonEvidence
      },
      {
        id: "strategy-2",
        title: "说明下一次的改变",
        tone: "direct",
        objective: "把道歉连接到具体行为修正。",
        message:
          "我为当时提高声音和直接打断你道歉。下次如果我又感到被指责，我会先说我听到了什么，再用十分钟缓一下，而不是立刻反驳。",
        whyItWorks: "可观察的改变比抽象承诺更能修复信任。",
        risk: "如果对方尚未准备好谈未来，可能觉得推进过快。",
        whenToUse: "对方更关注行为是否再次发生时。",
        confidence: 0.79,
        evidenceQuotes: commonEvidence
      },
      {
        id: "strategy-3",
        title: "询问修复所需条件",
        tone: "gentle",
        objective: "避免用道歉要求对方立即和好。",
        message:
          "我不想要求你马上原谅我。除了道歉，你觉得还需要我做到什么，才能让你重新觉得这段沟通是安全的？",
        whyItWorks: "把选择权交还给受伤一方，不把道歉变成交换条件。",
        risk: "如果对方正在强烈愤怒，开放式问题可能暂时难以回答。",
        whenToUse: "关系仍有修复意愿，但信任受损时。",
        confidence: 0.76,
        evidenceQuotes: commonEvidence
      }
    ];
  }

  if (goal === "decide") {
    return [
      {
        id: "strategy-1",
        title: "区分决定与情绪威胁",
        tone: "gentle",
        objective: "在讨论是否继续关系前先降低即时压力。",
        message:
          "我需要认真想清楚我们是否还能继续，但我不想在现在最激烈的时候直接做决定。我们都冷静一天，明天晚上只谈两个问题：哪些行为重复发生，是否愿意一起改变。",
        whyItWorks: "保留决定空间，同时把讨论限制在可验证的问题上。",
        risk: "对方可能把延后决定理解为拖延。",
        whenToUse: "分手或退出关系被频繁当作冲突手段时。",
        confidence: 0.8,
        evidenceQuotes: commonEvidence
      },
      {
        id: "strategy-2",
        title: "列出继续条件",
        tone: "direct",
        objective: "判断对方是否愿意为关系承担具体责任。",
        message:
          "如果要继续，我需要看到三点：不再辱骂，冲突时给明确暂停时间，以及在下一次出现同样问题时主动说明怎么处理。只承诺会改变不够，我需要具体行为。",
        whyItWorks: "把模糊希望转换为可观察条件。",
        risk: "对方可能口头同意但无法持续执行。",
        whenToUse: "已经多次发生同一模式，需要判断真实改变意愿时。",
        confidence: 0.83,
        evidenceQuotes: commonEvidence
      },
      {
        id: "strategy-3",
        title: "设置观察期并保留退出权",
        tone: "boundary",
        objective: "用有限时间验证改变，而不是无限等待。",
        message:
          "我愿意给这段关系一个明确的观察期，比如四周。如果辱骂、威胁或失联再次发生，我会把它视为同一种模式，而不是又一次意外。我会按这个标准做决定。",
        whyItWorks: "降低希望与现实之间的反复拉扯，让决定基于行为。",
        risk: "如果存在安全隐患，不应先承诺观察期。",
        whenToUse: "关系没有即时安全风险，但模式已重复多次时。",
        confidence: 0.77,
        evidenceQuotes: commonEvidence
      }
    ];
  }

  if (goal === "safety") {
    return [
      {
        id: "strategy-1",
        title: "优先确保即时安全",
        tone: "safety",
        objective: "停止普通关系说服，优先处理现实危险。",
        message:
          "如果现在有立即的人身危险，请先离开冲突现场并联系 110 或 120。如果存在自伤风险，请联系当地心理援助热线 12356，并让可信任的人陪伴你。关系沟通可以之后再处理。",
        whyItWorks: "立即安全优先于关系修复。",
        risk: "在线建议无法判断现场情况，真实危险需要线下支持。",
        whenToUse: "涉及自伤、他伤、威胁、暴力或失去基本安全控制时。",
        confidence: 0.95,
        evidenceQuotes: commonEvidence
      }
    ];
  }

  return [
    {
      id: "strategy-1",
      title: "先表达影响",
      tone: "gentle",
      objective: "让对方先理解这件事为什么重要。",
      message:
        "我想先把我的感受说清楚，不要求你现在同意。当你没有提前说明时，我会感到不安，然后把不安表现成追问。我真正想说的是，我希望我们有一个可以预期的联系方式。",
      whyItWorks: "降低指责，把感受、行为和需要连成一条完整信息。",
      risk: "对方可能仍先回应事实层面，需要允许对方按自己的节奏回应。",
      whenToUse: "对方并非拒绝沟通，但经常先进入解释或防御时。",
      confidence: 0.82,
      evidenceQuotes: commonEvidence
    },
    {
      id: "strategy-2",
      title: "提出一个可执行请求",
      tone: "direct",
      objective: "把抽象需要转换成对方可以做到的单一行为。",
      message:
        "下次如果会很忙，能不能在你预计联系不上之前发一句“今晚可能很晚”？我不需要你随时回复，只需要知道大概情况。",
      whyItWorks: "请求具体、成本低、没有要求对方承担全部情绪管理。",
      risk: "如果对方持续回避很小成本的行动，需要重新评估投入意愿。",
      whenToUse: "双方愿意调整，但过去没有明确操作方式时。",
      confidence: 0.85,
      evidenceQuotes: commonEvidence
    },
    {
      id: "strategy-3",
      title: "请求反馈而非立即承诺",
      tone: "repair",
      objective: "先了解对方的限制，再共同调整方案。",
      message:
        "我想知道，对你来说最困难的是工作节奏、我追问的方式，还是你不知道怎么回应我？我们只谈一个最现实的问题，再决定下一步。",
      whyItWorks: "给对方的压力来源留出位置，提升协商真实性。",
      risk: "如果对方长期回避所有沟通，开放问题可能继续被拖延。",
      whenToUse: "需求已经表达过一次，但双方还没有形成共同方案时。",
      confidence: 0.75,
      evidenceQuotes: commonEvidence
    }
  ];
}

export function generateStrategies(
  goal: Goal,
  dynamics: Dynamics,
  safety: SafetyAssessment,
  timeline: Timeline
): Strategy[] {
  const selectedGoal: Goal =
    safety.riskLevel === "high" ? "safety" : goal;
  const strategies = messagesForGoal(selectedGoal, dynamics.primaryPattern);
  const evidence = dynamics.evidenceQuotes.slice(0, 3);

  return strategies.map((strategy) => ({
    ...strategy,
    evidenceQuotes:
      strategy.evidenceQuotes.length > 0
        ? strategy.evidenceQuotes
        : evidence.length > 0
          ? evidence
          : timeline.events.slice(0, 2).map((event) => event.quote)
  }));
}
