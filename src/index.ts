#!/usr/bin/env node
/**
 * Recursive Thinking MCP Server
 *
 * Token-efficient tool for deep AI problem solving through iterative refinement.
 * Optimized for minimal token usage while maximizing solution quality.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  recursiveThink,
  processIteration,
  type ThinkingState
} from './lib.js';

// Session storage (in-memory, keyed by sessionId)
const sessions = new Map<string, ThinkingState>();

const RECURSIVE_THINKING_TOOL: Tool = {
  name: 'recursive_thinking',
  description: `Token-efficient recursive thinking engine for production-ready solutions.

HOW IT WORKS:
1. Start with action='start' and your task
2. Get a focused prompt back
3. Provide your response with action='iterate'
4. Repeat until isComplete=true

TOKEN OPTIMIZATION:
- Compresses insights automatically (~70% reduction)
- Uses minimal context per iteration
- Stops early when confidence threshold met (default: 85%)
- Limits iterations to max_depth (default: 5)

EXAMPLE CONFIGURATION:
{
  "maxDepth": 5,
  "minConfidence": 0.85,
  "maxIterations": 8
}

USAGE:
Call with action='start' to begin, then action='iterate' to refine.`,
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The problem/task to solve (required for start)',
        maxLength: 2000
      },
      response: {
        type: 'string',
        description: 'Agent response to previous thinking prompt (required for iterate)',
        maxLength: 3000
      },
      action: {
        type: 'string',
        enum: ['start', 'iterate'],
        description: 'Action to perform: start new thinking or iterate on existing'
      },
      sessionId: {
        type: 'string',
        description: 'Session identifier (auto-generated if not provided)'
      },
      config: {
        type: 'object',
        properties: {
          maxDepth: {
            type: 'number',
            description: 'Maximum recursion depth (default: 5)',
            minimum: 1,
            maximum: 10
          },
          minConfidence: {
            type: 'number',
            description: 'Confidence threshold to stop (default: 0.85)',
            minimum: 0,
            maximum: 1
          },
          maxIterations: {
            type: 'number',
            description: 'Max iterations (default: 8)',
            minimum: 1,
            maximum: 20
          }
        }
      }
    },
    required: ['action']
  }
};

// Create and configure server
const server = new Server(
  {
    name: 'mcp-server-recursive-thinking',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [RECURSIVE_THINKING_TOOL] };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== 'recursive_thinking') {
    throw new Error(`Unknown tool: ${name}`);
  }

  const { action, task, response, sessionId, config } = args as {
    action: 'start' | 'iterate';
    task?: string;
    response?: string;
    sessionId?: string;
    config?: any;
  };

  // Generate or use provided session ID
  const sid = sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (action === 'start') {
    if (!task || task.trim().length === 0) {
      throw new Error('Task is required for action=start');
    }

    // Initialize new session
    const initialState: ThinkingState = {
      depth: 0,
      confidence: 0,
      iterations: [],
      lastResult: '',
      isComplete: false
    };
    sessions.set(sid, initialState);

    const { result } = await recursiveThink(task, config);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            sessionId: sid,
            prompt: result,
            depth: 0,
            isComplete: false,
            instruction: 'Provide your response to this prompt, then call again with action=iterate'
          }, null, 2)
        }
      ]
    };

  } else if (action === 'iterate') {
    const state = sessions.get(sid);
    if (!state) {
      throw new Error(`Session ${sid} not found. Start with action=start first.`);
    }

    if (!response) {
      throw new Error('Response is required for action=iterate');
    }

    const originalTask = state.iterations[0] || response;
    const { nextPrompt, state: newState } = processIteration(
      originalTask,
      response,
      state,
      config
    );

    sessions.set(sid, newState);

    if (!nextPrompt || newState.isComplete) {
      // Return final compiled result
      const finalResult = {
        sessionId: sid,
        isComplete: true,
        depth: newState.depth,
        confidence: newState.confidence,
        iterations: newState.iterations,
        finalSolution: newState.lastResult,
        instruction: 'Production-ready solution achieved. Review iterations for full context.'
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(finalResult, null, 2)
          }
        ]
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            sessionId: sid,
            prompt: nextPrompt,
            depth: newState.depth,
            confidence: newState.confidence,
            isComplete: false,
            instruction: 'Continue iterating until isComplete=true'
          }, null, 2)
        }
      ]
    };

  } else {
    throw new Error(`Invalid action: ${action}. Use 'start' or 'iterate'`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Recursive Thinking MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
