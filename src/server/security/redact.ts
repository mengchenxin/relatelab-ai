import type { RedactionReport } from "../../shared/contracts.ts";

type RedactionKey = keyof RedactionReport["counts"];

const patterns: Array<{
  key: RedactionKey;
  pattern: RegExp;
  replacement: string;
}> = [
  {
    key: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[邮箱]"
  },
  {
    key: "idCard",
    pattern: /(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
    replacement: "[身份证号]"
  },
  {
    key: "bankCard",
    pattern: /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g,
    replacement: "[银行卡号]"
  },
  {
    key: "phone",
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    replacement: "[手机号]"
  }
];

export function redactText(input: string): RedactionReport {
  let text = input;
  const counts: RedactionReport["counts"] = {
    phone: 0,
    email: 0,
    idCard: 0,
    bankCard: 0
  };

  for (const rule of patterns) {
    text = text.replace(rule.pattern, () => {
      counts[rule.key] += 1;
      return rule.replacement;
    });
  }

  return {
    originalCharacters: input.length,
    redactedCharacters: text.length,
    counts,
    text
  };
}
