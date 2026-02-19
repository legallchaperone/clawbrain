import { describe, it, expect } from 'vitest';
import {
  analyzeUserMessage,
  analyzeAgentResponse,
  analyzeToolCalls,
  computeTurnOutcome,
  computeReward,
} from '../src/utils/outcome-signals';
import type { TurnOutcome, ToolCallRecord } from '../src/types';

describe('Outcome Signals', () => {
  describe('analyzeUserMessage', () => {
    it('should detect positive feedback', () => {
      const result = analyzeUserMessage('Thanks, that was perfect!');
      expect(result.satisfaction).toBeGreaterThan(0);
      expect(result.isCorrection).toBe(false);
    });

    it('should detect corrections', () => {
      const result = analyzeUserMessage("No, I meant the other file");
      expect(result.satisfaction).toBeLessThan(0);
      expect(result.isCorrection).toBe(true);
    });

    it('should detect explicit negative feedback', () => {
      const result = analyzeUserMessage("That's wrong, try again");
      expect(result.isCorrection).toBe(true);
    });

    it('should handle neutral messages', () => {
      const result = analyzeUserMessage(
        'Can you show me the file structure?',
      );
      expect(result.satisfaction).toBe(0);
      expect(result.isCorrection).toBe(false);
    });

    it('should detect multiple positive signals', () => {
      const result = analyzeUserMessage(
        'Great job, exactly what I needed, thanks!',
      );
      expect(result.satisfaction).toBeGreaterThan(0.3);
    });
  });

  describe('analyzeAgentResponse', () => {
    it('should detect task completion', () => {
      const result = analyzeAgentResponse(
        'Done! I have successfully created the file and updated the config.',
      );
      expect(result.taskCompleted).toBe(true);
    });

    it('should not flag partial mentions as completion', () => {
      const result = analyzeAgentResponse(
        'Let me look into this issue for you.',
      );
      expect(result.taskCompleted).toBe(false);
    });
  });

  describe('analyzeToolCalls', () => {
    it('should report success when all tools succeed', () => {
      const tools: ToolCallRecord[] = [
        { name: 'read', success: true },
        { name: 'write', success: true },
      ];
      const result = analyzeToolCalls(tools);
      expect(result.toolSuccess).toBe(true);
      expect(result.successRate).toBe(1.0);
    });

    it('should report failure when most tools fail', () => {
      const tools: ToolCallRecord[] = [
        { name: 'read', success: false },
        { name: 'write', success: false },
        { name: 'edit', success: true },
      ];
      const result = analyzeToolCalls(tools);
      expect(result.toolSuccess).toBe(false);
    });

    it('should handle empty tool calls', () => {
      const result = analyzeToolCalls([]);
      expect(result.toolSuccess).toBe(true);
      expect(result.successRate).toBe(1.0);
    });
  });

  describe('computeTurnOutcome', () => {
    it('should combine all signals', () => {
      const outcome = computeTurnOutcome({
        userMessage: 'Thanks, perfect!',
        agentResponse: 'Done! File created successfully.',
        toolCalls: [{ name: 'write', success: true }],
      });

      expect(outcome.taskCompleted).toBeDefined();
      expect(outcome.userSatisfaction).toBeGreaterThan(0);
      expect(outcome.toolSuccess).toBe(true);
      expect(outcome.userCorrection).toBe(false);
    });
  });

  describe('computeReward', () => {
    it('should return positive reward for success', () => {
      const outcome: TurnOutcome = {
        taskCompleted: true,
        userSatisfaction: 0.5,
        toolSuccess: true,
        userCorrection: false,
        conversationAbandoned: false,
        conversationContinued: true,
      };
      const reward = computeReward(outcome);
      expect(reward).toBeGreaterThan(0);
    });

    it('should return negative reward for failure', () => {
      const outcome: TurnOutcome = {
        taskCompleted: false,
        userSatisfaction: -0.5,
        toolSuccess: false,
        userCorrection: true,
        conversationAbandoned: true,
        conversationContinued: false,
      };
      const reward = computeReward(outcome);
      expect(reward).toBeLessThan(0);
    });

    it('should clamp reward to [-1, 1]', () => {
      const extremePositive: TurnOutcome = {
        taskCompleted: true,
        userSatisfaction: 1.0,
        toolSuccess: true,
        userCorrection: false,
        conversationAbandoned: false,
        conversationContinued: true,
      };
      expect(computeReward(extremePositive)).toBeLessThanOrEqual(1.0);

      const extremeNegative: TurnOutcome = {
        taskCompleted: false,
        userSatisfaction: -1.0,
        toolSuccess: false,
        userCorrection: true,
        conversationAbandoned: true,
        conversationContinued: false,
      };
      expect(computeReward(extremeNegative)).toBeGreaterThanOrEqual(-1.0);
    });
  });
});
