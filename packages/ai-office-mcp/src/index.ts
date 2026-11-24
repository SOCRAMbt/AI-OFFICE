#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "ai-office-mcp",
  version: "4.1.0",
});

// Tool: office status
server.tool(
  "office_status",
  "Get the current status of the AI-OFFICE run",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ status: "ready", version: "4.1.0" }, null, 2),
        },
      ],
    };
  }
);

// Tool: office plan
server.tool(
  "office_plan",
  "Plan a set of cards for an objective",
  {
    objective: z.string().describe("The objective to plan for"),
  },
  async ({ objective }) => {
    return {
      content: [
        {
          type: "text",
          text: `Planning objective: ${objective}. Use the oficina engine for full planning.`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
