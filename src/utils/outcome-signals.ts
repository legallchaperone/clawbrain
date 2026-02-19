/**
 * Heuristic outcome signal detection.
 *
 * Infers task success/failure from conversational cues,
 * tool call results, and user behavior patterns.
 */

import type { TurnOutcome, ToolCallRecord } from '../types';

/**
 * Positive feedback patterns (case-insensitive).
 */
const POSITIVE_PATTERNS = [
  /\bthanks?\b/i,
  /\bthank\s+you\b/i,
  /\bperfect\b/i,
  /\bgreat\b/i,
  /\bexcellent\b/i,
  /\bawesome\b/i,
  /\bexactly\b/i,
  /\bthat'?s?\s+(right|correct|it|what\s+i\s+(need|want))\b/i,
  /\bwell\s+done\b/i,
  /\bgood\s+job\b/i,
  /\bnailed\s+it\b/i,
  /\blgtm\b/i,
  /\b(love|like)\s+(it|this|that)\b/i,
  /\bworks?\s+(great|perfectly|well|fine)\b/i,
  /\byep\b/i,
  /\byeah\b/i,
  /\byes\b/i,
  /\bnice\b/i,
  /\bcool\b/i,
  /\bspot\s+on\b/i,
];

/**
 * Correction/negative patterns (case-insensitive).
 */
const CORRECTION_PATTERNS = [
  /\bno[,.]?\s+(i\s+)?(meant|mean|want|need)\b/i,
  /\bthat'?s?\s+(wrong|incorrect|not\s+(right|correct|what))\b/i,
  /\bactually[,.]?\s+(i\s+)?(meant|mean|want|need)\b/i,
  /\bwrong\b/i,
  /\bnot\s+what\s+i\s+(asked|wanted|meant)\b/i,
  /\btry\s+again\b/i,
  /\bredo\s+(this|that|it)\b/i,
  /\bplease\s+(fix|correct|change)\b/i,
  /\bthat\s+doesn'?t\s+(work|make\s+sense)\b/i,
  /\bstop\b/i,
  /\bcancel\b/i,
  /\bnope\b/i,
];

/**
 * Task completion indicators.
 */
const COMPLETION_PATTERNS = [
  /\bdone\b/i,
  /\bcompleted?\b/i,
  /\bfinished?\b/i,
  /\bsuccessful(ly)?\b/i,
  /\bcreated?\b/i,
  /\bsaved?\b/i,
  /\bupdated?\b/i,
  /\bdeployed?\b/i,
  /\bcommitted?\b/i,
  /\bpushed?\b/i,
  /\bmerged?\b/i,
  /\binstalled?\b/i,
  /\bfixed?\b/i,
];

/**
 * Analyze the user's message for positive/negative sentiment.
 */
export function analyzeUserMessage(message: string): {
  satisfaction: number;
  isCorrection: boolean;
} {
  let satisfaction = 0;

  const positiveCount = POSITIVE_PATTERNS.filter((p) =>
    p.test(message),
  ).length;
  const correctionCount = CORRECTION_PATTERNS.filter((p) =>
    p.test(message),
  ).length;

  if (positiveCount > 0) {
    satisfaction = Math.min(positiveCount * 0.3, 1.0);
  }
  if (correctionCount > 0) {
    satisfaction = -Math.min(correctionCount * 0.4, 1.0);
  }

  return {
    satisfaction,
    isCorrection: correctionCount > 0,
  };
}

/**
 * Analyze the agent's response for task completion indicators.
 */
export function analyzeAgentResponse(response: string): {
  taskCompleted: boolean;
} {
  const completionCount = COMPLETION_PATTERNS.filter((p) =>
    p.test(response),
  ).length;

  return {
    taskCompleted: completionCount >= 2,
  };
}

/**
 * Analyze tool call results for success/failure.
 */
export function analyzeToolCalls(toolCalls: ToolCallRecord[]): {
  toolSuccess: boolean;
  successRate: number;
} {
  if (toolCalls.length === 0) {
    return { toolSuccess: true, successRate: 1.0 };
  }

  const successCount = toolCalls.filter((tc) => tc.success).length;
  const successRate = successCount / toolCalls.length;

  return {
    toolSuccess: successRate >= 0.5,
    successRate,
  };
}

/**
 * Compute a full TurnOutcome from all available signals.
 */
export function computeTurnOutcome(params: {
  userMessage?: string;
  agentResponse?: string;
  toolCalls?: ToolCallRecord[];
  sessionEndedAbruptly?: boolean;
  previousTurnHadRetrieval?: boolean;
}): TurnOutcome {
  const userAnalysis = params.userMessage
    ? analyzeUserMessage(params.userMessage)
    : { satisfaction: 0, isCorrection: false };

  const agentAnalysis = params.agentResponse
    ? analyzeAgentResponse(params.agentResponse)
    : { taskCompleted: false };

  const toolAnalysis = analyzeToolCalls(params.toolCalls ?? []);

  return {
    taskCompleted: agentAnalysis.taskCompleted && toolAnalysis.toolSuccess,
    userSatisfaction: userAnalysis.satisfaction,
    toolSuccess: toolAnalysis.toolSuccess,
    userCorrection: userAnalysis.isCorrection,
    conversationAbandoned: params.sessionEndedAbruptly ?? false,
    conversationContinued: !params.sessionEndedAbruptly && !!params.userMessage,
  };
}

/**
 * Compute a scalar reward from a TurnOutcome.
 *
 * Maps multi-dimensional outcome signals to a single [-1, 1] value
 * for use in credit assignment.
 */
export function computeReward(outcome: TurnOutcome): number {
  let reward = 0.0;

  if (outcome.taskCompleted) {
    reward += 0.5;
  }
  if (outcome.userSatisfaction > 0) {
    reward += 0.3 * outcome.userSatisfaction;
  }
  if (outcome.toolSuccess) {
    reward += 0.1;
  }
  if (outcome.userCorrection) {
    reward -= 0.4;
  }
  if (outcome.conversationAbandoned) {
    reward -= 0.2;
  }
  if (outcome.conversationContinued && !outcome.userCorrection) {
    reward += 0.1;
  }

  return Math.max(-1.0, Math.min(1.0, reward));
}
