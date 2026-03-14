#!/usr/bin/env node
/**
 * Chain-of-Thought Recursive Thinking MCP Server
 *
 * Features:
 * - Chain of Thought: AI explains reasoning behind each decision
 * - Self-Evaluation: AI rates its own solutions (good/bad)
 * - Rethink Mechanism: Continuous refinement without token waste
 * - Token Efficiency: Smart compression and phase-based prompts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  recursiveThink,
  processIteration,
  type ThinkingState,
  type ThinkingPhase,
} from "./lib.js";

// Session storage (in-memory, keyed by sessionId)
const sessions = new Map<string, ThinkingState>();

const RECURSIVE_THINKING_TOOL: Tool = {
  name: "recursive_thinking",
  description: `Chain-of-Thought recursive thinking engine with self-evaluation.

HOW IT WORKS:
1. Start with action='start' and your task
2. AI receives phase-specific prompts (explore → justify → evaluate → rethink → finalize)
3. AI explains reasoning, rates its solution, and rethinks if needed
4. Continues until production-ready (confidence ≥85%, rating ≥7/10)

KEY FEATURES:
- Chain of Thought: AI explains WHY it chose each solution
- Self-Evaluation: AI rates solutions (1-10 scale, good/bad flag)
- Rethink Loop: Automatically rethinks if rating <7 or issues found
- Token Efficient: Compresses history, phase-focused prompts

PHASES:
1. EXPLORE: Propose solution with reasoning
2. JUSTIFY: Critically examine your reasoning
3. EVALUATE: Rate your solution (1-10, good/bad)
4. RETHINK: Improve based on weaknesses (if needed)
5. FINALIZE: Compile production-ready solution

CONFIGURATION:
{
  "maxDepth": 5,
  "minConfidence": 0.85,
  "minRating": 7,          // Minimum score (1-10) to accept
  "enableRethinking": true // Enable continuous refinement
}

USAGE:
Call with action='start' to begin, then action='iterate' with your response.`,
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The problem/task to solve (required for start)",
        maxLength: 2000,
      },
      response: {
        type: "string",
        description:
          "Agent response to previous thinking prompt (required for iterate)",
        maxLength: 5000,
      },
      action: {
        type: "string",
        enum: ["start", "iterate"],
        description:
          "Action to perform: start new thinking or iterate on existing",
      },
      sessionId: {
        type: "string",
        description: "Session identifier (auto-generated if not provided)",
      },
      config: {
        type: "object",
        properties: {
          maxDepth: {
            type: "number",
            description: "Maximum recursion depth (default: 5)",
            minimum: 1,
            maximum: 10,
          },
          minConfidence: {
            type: "number",
            description: "Confidence threshold to stop (default: 0.85)",
            minimum: 0,
            maximum: 1,
          },
          minRating: {
            type: "number",
            description: "Minimum acceptable rating 1-10 (default: 7)",
            minimum: 1,
            maximum: 10,
          },
          enableRethinking: {
            type: "boolean",
            description: "Enable continuous refinement loop (default: true)",
          },
          maxIterations: {
            type: "number",
            description: "Max iterations (default: 8)",
            minimum: 1,
            maximum: 20,
          },
        },
      },
    },
    required: ["action"],
  },
};

// Create and configure server
const server = new Server(
  {
    name: "mcp-server-recursive-thinking",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [RECURSIVE_THINKING_TOOL] };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== "recursive_thinking") {
    throw new Error(`Unknown tool: ${name}`);
  }

  const { action, task, response, sessionId, config } = args as {
    action: "start" | "iterate";
    task?: string;
    response?: string;
    sessionId?: string;
    config: any;
  };

  // Generate or use provided session ID
  const sid =
    sessionId ||
    `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (action === "start") {
    if (!task || task.trim().length === 0) {
      throw new Error("Task is required for action=start");
    }

    // Initialize new session
    const initialState: ThinkingState = {
      depth: 0,
      confidence: 0,
      iterations: [],
      lastResult: "",
      isComplete: false,
      currentPhase: "explore",
      rethinking: false,
    };
    sessions.set(sid, initialState);

    const { result } = await recursiveThink(task, config);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sessionId: sid,
              phase: "explore",
              prompt: result,
              depth: 0,
              isComplete: false,
              instruction:
                "Provide your solution with reasoning. Include: [solution][reasoning][alternatives]. Then call again with action=iterate",
            },
            null,
            2,
          ),
        },
      ],
    };
  } else if (action === "iterate") {
    const state = sessions.get(sid);
    if (!state) {
      throw new Error(
        `Session ${sid} not found. Start with action=start first.`,
      );
    }

    if (!response) {
      throw new Error("Response is required for action=iterate");
    }

    const originalTask = state.iterations[0]?.solution || response;
    const {
      nextPrompt,
      state: newState,
      phase,
    } = processIteration(originalTask, response, state, config);

    sessions.set(sid, newState);

    if (!nextPrompt || newState.isComplete) {
      // Return final compiled result
      const finalResult = {
        sessionId: sid,
        isComplete: true,
        phase: "finalize",
        depth: newState.depth,
        confidence: newState.confidence,
        iterations: newState.iterations.map((iter, idx) => ({
          iteration: idx + 1,
          phase: "completed",
          solution: iter.solution,
          reasoning: iter.reasoning,
          selfRating: iter.selfRating,
          improvements: iter.improvements,
        })),
        finalSolution: newState.lastResult,
        summary: {
          totalIterations: newState.iterations.length,
          finalConfidence: newState.confidence,
          finalRating:
            newState.iterations[newState.iterations.length - 1]?.selfRating,
          rethinkingEnabled: config?.enableRethinking ?? true,
        },
        instruction:
          "Production-ready solution achieved. Review iterations for full reasoning chain.",
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(finalResult, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sessionId: sid,
              phase: phase,
              prompt: nextPrompt,
              depth: newState.depth,
              confidence: newState.confidence,
              currentRating:
                newState.iterations[newState.iterations.length - 1]?.selfRating,
              isComplete: false,
              instruction: getPhaseInstruction(phase),
            },
            null,
            2,
          ),
        },
      ],
    };
  } else {
    throw new Error(`Invalid action: ${action}. Use 'start' or 'iterate'`);
  }
});

/**
 * Returns instruction text based on current phase
 */
function getPhaseInstruction(phase: ThinkingPhase): string {
  const instructions: Record<ThinkingPhase, string> = {
    explore:
      "Provide your solution with reasoning and alternatives considered.",
    justify:
      "Critically examine your reasoning. What assumptions are you making?",
    evaluate: "Rate your solution (1-10). Be honest about weaknesses.",
    rethink: "Improve your solution based on identified weaknesses.",
    finalize: "Compile your final production-ready solution.",
  };
  return instructions[phase] || "Continue iterating.";
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    "Chain-of-Thought Recursive Thinking MCP Server v2.0.0 running on stdio",
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
