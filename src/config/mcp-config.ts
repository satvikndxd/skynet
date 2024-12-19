export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  port: number;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

// Function to load MCP config from JSON file
export async function loadMCPConfig(): Promise<MCPConfig> {
  try {
    const response = await fetch('/mcp-config.json');
    if (!response.ok) {
      throw new Error(`Failed to load MCP config: ${response.statusText}`);
    }
    return await response.json() as MCPConfig;
  } catch (error) {
    console.error('Error loading MCP config:', error);
    // Return empty config if file cannot be loaded
    return { mcpServers: {} };
  }
}
