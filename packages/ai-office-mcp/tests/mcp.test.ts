import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("ai-office-mcp", () => {
  it("should create an MCP server", () => {
    const server = new McpServer({
      name: "ai-office-mcp",
      version: "4.1.0",
    });
    expect(server).toBeDefined();
    // Server name is set in constructor but may not be directly accessible
    expect(typeof server.tool).toBe("function");
    expect(typeof server.resource).toBe("function");
    expect(typeof server.prompt).toBe("function");
  });
});