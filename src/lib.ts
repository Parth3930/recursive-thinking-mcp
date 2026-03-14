/**
 * Chain-of-Thought Recursive Thinking Engine
 *
 * Features:
 * - Chain of Thought: AI explains reasoning behind each decision
 * - Self-Evaluation: AI rates its own solutions (good/bad)
 * - Rethink Mechanism: Continuous refinement loop
 * - Token Efficiency: Smart compression to avoid waste
 */

interface ThinkingState {
  depth: number;
  confidence: number;
  iterations: Iteration[];
  lastResult: string;
  isComplete: boolean;
  currentPhase: ThinkingPhase;
  rethinking: boolean;
}

interface Iteration {
  solution: string;
  reasoning: string; // Why this solution was chosen
  selfRating: Rating; // AI's own evaluation
  improvements: string; // What could be better
}

interface Rating {
  score: number; // 1-10 scale
  isGood: boolean; // Simple good/bad flag
  rationale: string; // Why this rating
}

type ThinkingPhase =
  | "explore"
  | "justify"
  | "evaluate"
  | "rethink"
  | "finalize";

interface ThinkingConfig {
  maxDepth: number;
  minConfidence: number;
  maxIterations: number;
  minRating: number; // Minimum acceptable self-rating (1-10)
  enableRethinking: boolean;
  temperature: number;
}

const DEFAULT_CONFIG: ThinkingConfig = {
  maxDepth: 5,
  minConfidence: 0.85,
  maxIterations: 8,
  minRating: 7, // Solutions must score 7+ to be accepted
  enableRethinking: true, // Enable continuous refinement
  temperature: 0.7,
};

/**
 * Compresses context by extracting only key insights
 * Enhanced to preserve reasoning and evaluation data
 */
function compressInsights(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim());
  const keywords = [
    "therefore",
    "conclusion",
    "solution",
    "approach",
    "error",
    "issue",
    "fixed",
    "implement",
    "because",
    "reason",
    "why",
    "rating",
    "score",
  ];
  return lines
    .filter((line) => keywords.some((kw) => line.toLowerCase().includes(kw)))
    .join("\n")
    .slice(0, 500);
}

/**
 * Compresses iteration history while preserving critical reasoning
 */
function compressIterations(
  iterations: Iteration[],
  maxKeep: number = 3,
): string {
  if (iterations.length === 0) return "No previous iterations";

  const recent = iterations.slice(-maxKeep);
  const compressed = recent
    .map((iter, idx) => {
      const insight = compressInsights(iter.solution);
      const rating = iter.selfRating.isGood ? "✓" : "✗";
      return `[${idx + 1}] ${rating} Score:${iter.selfRating.score}/10 | ${insight.slice(0, 100)}`;
    })
    .join("\n");

  return compressed;
}

/**
 * Generates phase-specific prompts for chain-of-thought reasoning
 */
function generateThinkingPrompt(
  originalTask: string,
  state: ThinkingState,
  config: ThinkingConfig,
): string {
  const task = originalTask.slice(0, 200);

  switch (state.currentPhase) {
    case "explore":
      return `## PHASE 1: EXPLORE SOLUTION

Task: "${task}"

${state.depth > 0 ? `Previous iterations:\n${compressIterations(state.iterations)}\n` : ""}

Provide your solution with this structure:
1. **Solution**: What approach will you take?
2. **Reasoning**: WHY did you choose this? (explain your thought process)
3. **Alternatives Considered**: What other options did you reject and why?

Format: Concise, action-oriented. Max 300 words.`;

    case "justify":
      return `## PHASE 2: JUSTIFY YOUR REASONING

Task: "${task.slice(0, 100)}..."
Your Solution: "${state.lastResult.slice(0, 150)}..."

CRITICALLY EXAMINE your reasoning:
1. **Why This Works**: What makes your approach correct?
2. **Hidden Assumptions**: What are you assuming that might be wrong?
3. **Edge Cases**: What scenarios might break your solution?
4. **Confidence**: Rate 0-1 (e.g., 0.85)

Be honest about weaknesses. Format: Max 250 words.`;

    case "evaluate":
      return `## PHASE 3: SELF-EVALUATION

Rate your solution CRITICALLY:

1. **Score** (1-10): Be harsh. 10 = production perfect.
2. **Is Good?** (true/false): Would you bet your reputation on this?
3. **Rationale**: Why this rating? What's missing?
4. **Improvements**: What MUST be improved before production?

Format:
{
  "score": 7,
  "isGood": false,
  "rationale": "...",
  "improvements": "..."
}

Be brutally honest. Weaknesses now = fewer bugs later.`;

    case "rethink":
      const weaknesses =
        state.iterations[state.iterations.length - 1]?.improvements ||
        "unspecified";
      return `## PHASE 4: RETHINK & IMPROVE

Task: "${task.slice(0, 100)}..."
Previous Score: ${state.iterations[state.iterations.length - 1]?.selfRating.score || "N"}/10
Identified Weaknesses: "${weaknesses}"

YOUR SOLUTION WAS RATED: ${state.iterations[state.iterations.length - 1]?.selfRating.isGood ? "GOOD" : "NEEDS WORK"}

RETHINK required:
1. **What Was Wrong**: Acknowledge the flaws in previous approach
2. **New Approach**: How will you address the weaknesses?
3. **Why Better**: What makes this iteration superior?
4. **New Confidence**: Rate 0-1

Format: Max 300 words. Focus on concrete improvements.`;

    case "finalize":
    default:
      return `## PHASE 5: FINALIZE SOLUTION

Task: "${task}"

Compile your FINAL production-ready solution:

1. **Final Solution**: Complete, tested approach
2. **Why This Is Best**: Synthesize all learnings from iterations
3. **Confidence**: 0-1 (must be ≥${config.minConfidence})
4. **Production Checklist**:
   - [ ] Edge cases handled
   - [ ] Error handling complete
   - [ ] Performance considered
   - [ ] Security addressed
   - [ ] Maintainable code

Format: Production-ready detail. No word limit.`;
  }
}

/**
 * Determines the next phase based on current state and evaluation
 */
function determineNextPhase(
  state: ThinkingState,
  config: ThinkingConfig,
): ThinkingPhase {
  if (!state.rethinking && state.currentPhase === "explore") {
    return "justify";
  }

  if (state.currentPhase === "justify") {
    return "evaluate";
  }

  if (state.currentPhase === "evaluate") {
    const lastRating =
      state.iterations[state.iterations.length - 1]?.selfRating;

    // If rating is low OR rethinking is enabled and not good, rethink
    if (
      !lastRating?.isGood ||
      (config.enableRethinking && lastRating.score < config.minRating)
    ) {
      if (state.depth < config.maxDepth) {
        return "rethink";
      }
    }

    // If confidence is high enough and rating is good, finalize
    if (state.confidence >= config.minConfidence && lastRating?.isGood) {
      return "finalize";
    }

    // If max depth reached, finalize anyway
    if (state.depth >= config.maxDepth) {
      return "finalize";
    }

    return "rethink";
  }

  if (state.currentPhase === "rethink") {
    return "explore"; // Loop back to explore with new approach
  }

  if (state.currentPhase === "finalize") {
    return "finalize";
  }

  return "explore";
}

/**
 * Evaluates if the solution is production-ready
 * Enhanced with self-evaluation criteria
 */
function isProductionReady(
  result: string,
  confidence: number,
  rating: Rating,
  config: ThinkingConfig,
): boolean {
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
    "production",
  ];

  const hasProdKeywords = prodIndicators.some((kw) =>
    result.toLowerCase().includes(kw),
  );

  // Must have: high confidence, good rating, production keywords, sufficient detail
  return (
    confidence >= config.minConfidence &&
    rating.isGood &&
    rating.score >= config.minRating &&
    hasProdKeywords &&
    result.length > 100
  );
}

/**
 * Parses self-evaluation from agent response
 */
function parseSelfEvaluation(response: string): Rating | null {
  // Try to find JSON-like structure for rating
  const jsonMatch = response.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const jsonStr = jsonMatch[0].replace(/(\w+):/g, '"$1":'); // Fix unquoted keys
      const parsed = JSON.parse(jsonStr);
      if (parsed.score !== undefined) {
        return {
          score: Math.min(10, Math.max(1, parsed.score)),
          isGood: parsed.isGood ?? parsed.score >= 7,
          rationale: parsed.rationale || "No rationale provided",
        };
      }
    } catch (e) {
      // Fall through to regex parsing
    }
  }

  // Fallback: parse with regex
  const scoreMatch = response.match(/score[:\s]*([0-9]+)/i);
  const isGoodMatch = response.match(/is\s*good[:\s]*(true|false)/i);
  const rationaleMatch = response.match(/rationale[:\s]*([^}\n]+)/i);

  if (scoreMatch) {
    const score = parseInt(scoreMatch[1]);
    return {
      score: Math.min(10, Math.max(1, score)),
      isGood: isGoodMatch
        ? isGoodMatch[1].toLowerCase() === "true"
        : score >= 7,
      rationale: rationaleMatch
        ? rationaleMatch[1].trim()
        : "Auto-extracted rating",
    };
  }

  return null;
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
    currentPhase: "explore",
    rethinking: false,
  };

  return {
    result: generateThinkingPrompt(task, state, finalConfig),
    iterations: 0,
    confidence: 0,
  };
}

/**
 * Processes agent response and advances the thinking state
 */
export function processIteration(
  originalTask: string,
  agentResponse: string,
  previousState: ThinkingState,
  config: Partial<ThinkingConfig> = {},
): { nextPrompt: string | null; state: ThinkingState; phase: ThinkingPhase } {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Extract confidence from response
  const confidenceMatch = agentResponse.match(/confidence[:\s]*([0-9.]+)/i);
  const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;

  // Parse self-evaluation if in evaluate phase
  let selfRating: Rating = {
    score: 5,
    isGood: false,
    rationale: "Not yet evaluated",
  };
  if (previousState.currentPhase === "evaluate") {
    const parsed = parseSelfEvaluation(agentResponse);
    if (parsed) {
      selfRating = parsed;
    }
  }

  // Build new iteration
  const newIteration: Iteration = {
    solution: agentResponse,
    reasoning: extractReasoning(agentResponse),
    selfRating: selfRating,
    improvements: extractImprovements(agentResponse),
  };

  const newState: ThinkingState = {
    depth: previousState.depth + 1,
    confidence,
    iterations: [...previousState.iterations, newIteration],
    lastResult: agentResponse,
    isComplete: false,
    currentPhase: previousState.currentPhase,
    rethinking: previousState.currentPhase === "rethink",
  };

  // Determine next phase
  const nextPhase = determineNextPhase(newState, finalConfig);
  newState.currentPhase = nextPhase;

  // Check if we should finalize
  const lastRating =
    newState.iterations[newState.iterations.length - 1]?.selfRating;
  if (
    isProductionReady(agentResponse, confidence, lastRating, finalConfig) ||
    newState.depth >= finalConfig.maxDepth ||
    nextPhase === "finalize"
  ) {
    newState.isComplete = true;
    newState.currentPhase = "finalize";
    return { nextPrompt: null, state: newState, phase: "finalize" };
  }

  return {
    nextPrompt: generateThinkingPrompt(originalTask, newState, finalConfig),
    state: newState,
    phase: nextPhase,
  };
}

/**
 * Extracts reasoning from agent response
 */
function extractReasoning(response: string): string {
  const reasoningMatch = response.match(/reasoning[:\s]*([^}\n]+)/i);
  const whyMatch = response.match(/why[:\s]*([^}\n]+)/i);
  const becauseMatch = response.match(/because[:\s]*([^}\n]+)/i);

  if (reasoningMatch) return reasoningMatch[1].trim();
  if (whyMatch) return whyMatch[1].trim();
  if (becauseMatch) return becauseMatch[1].trim();

  // Fallback: extract first paragraph that contains reasoning keywords
  const lines = response.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    if (
      line.toLowerCase().includes("because") ||
      line.toLowerCase().includes("therefore") ||
      line.toLowerCase().includes("since")
    ) {
      return line.trim();
    }
  }

  return "Reasoning not explicitly stated";
}

/**
 * Extracts improvement areas from agent response
 */
function extractImprovements(response: string): string {
  const improvementsMatch = response.match(/improvements[:\s]*([^}\n]+)/i);
  const weaknessesMatch = response.match(/weaknesses[:\s]*([^}\n]+)/i);
  const missingMatch = response.match(/missing[:\s]*([^}\n]+)/i);

  if (improvementsMatch) return improvementsMatch[1].trim();
  if (weaknessesMatch) return weaknessesMatch[1].trim();
  if (missingMatch) return missingMatch[1].trim();

  return "No improvements identified";
}

export type { ThinkingState, ThinkingConfig, Iteration, Rating, ThinkingPhase };
