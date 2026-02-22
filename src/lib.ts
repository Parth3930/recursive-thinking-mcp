/**
 * Token-efficient recursive thinking engine
 * Optimized for minimal token usage while maximizing solution depth
 */

interface ThinkingState {
  depth: number;
  confidence: number;
  iterations: string[];
  lastResult: string;
  isComplete: boolean;
}

interface ThinkingConfig {
  maxDepth: number;
  minConfidence: number;
  maxIterations: number;
  temperature: number;
}

const DEFAULT_CONFIG: ThinkingConfig = {
  maxDepth: 5,
  minConfidence: 0.85,
  maxIterations: 8,
  temperature: 0.7,
};

/**
 * Compresses context by extracting only key insights
 */
function compressInsights(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim());
  // Keep only lines that contain key indicators
  const keywords = [
    "therefore",
    "conclusion",
    "solution",
    "approach",
    "error",
    "issue",
    "fixed",
    "implement",
  ];
  return lines
    .filter((line) => keywords.some((kw) => line.toLowerCase().includes(kw)))
    .join("\n")
    .slice(0, 500); // Limit to 500 chars
}

/**
 * Generates a concise thinking prompt based on current state
 */
function generateThinkingPrompt(
  originalTask: string,
  state: ThinkingState,
  config: ThinkingConfig,
): string {
  if (state.depth === 0) {
    return `Analyze task: "${originalTask.slice(0, 200)}"
Provide: [approach][potential_issues][confidence_0-1]
Format: Single paragraph, minimal words.`;
  }

  const previousInsights = compressInsights(state.lastResult);

  return `Refine solution (depth ${state.depth}/${config.maxDepth}):
Task: "${originalTask.slice(0, 100)}..."
Previous: "${previousInsights}"
Current confidence: ${state.confidence}
Provide: [refinement][what_to_improve][new_confidence]
Format: Concise, action-oriented.`;
}

/**
 * Evaluates if the solution is production-ready
 */
function isProductionReady(result: string, confidence: number): boolean {
  const prodIndicators = [
    "implement",
    "complete",
    "final",
    "solution",
    "ready",
    "tested",
    "handle",
    "error",
    "edge case",
    "deploy",
  ];

  const hasProdKeywords = prodIndicators.some((kw) =>
    result.toLowerCase().includes(kw),
  );

  return confidence >= 0.85 && hasProdKeywords && result.length > 50;
}

/**
 * Main recursive thinking function
 */
export async function recursiveThink(
  task: string,
  config: Partial<ThinkingConfig> = {},
): Promise<{ result: string; iterations: number; confidence: number }> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const state: ThinkingState = {
    depth: 0,
    confidence: 0,
    iterations: [],
    lastResult: "",
    isComplete: false,
  };

  // This would be called by the AI agent using this tool
  // The tool returns structured prompts for the agent to respond to
  return {
    result: generateThinkingPrompt(task, state, finalConfig),
    iterations: 0,
    confidence: 0,
  };
}

/**
 * Process an iteration and return the next prompt or final result
 */
export function processIteration(
  originalTask: string,
  agentResponse: string,
  previousState: ThinkingState,
  config: Partial<ThinkingConfig> = {},
): { nextPrompt: string | null; state: ThinkingState } {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Extract confidence from response
  const confidenceMatch = agentResponse.match(/confidence[:\s]*([0-9.]+)/i);
  const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;

  const newState: ThinkingState = {
    depth: previousState.depth + 1,
    confidence,
    iterations: [...previousState.iterations, agentResponse],
    lastResult: agentResponse,
    isComplete: false,
  };

  // Check if production-ready
  if (
    isProductionReady(agentResponse, confidence) ||
    newState.depth >= finalConfig.maxDepth ||
    confidence >= finalConfig.minConfidence
  ) {
    newState.isComplete = true;
    return { nextPrompt: null, state: newState };
  }

  return {
    nextPrompt: generateThinkingPrompt(originalTask, newState, finalConfig),
    state: newState,
  };
}

export type { ThinkingState, ThinkingConfig };
