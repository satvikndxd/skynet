import { WebSocketServer } from 'ws';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, '../../mcp-config.json');

// Store MCP clients and their tools
const mcpClients = new Map();

// Helper for consistent logging
function log(type, message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${type}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// Initialize WebSocket server
const wss = new WebSocketServer({ port: 3001 });

// Load MCP server configurations
async function loadConfig() {
  try {
    const configFile = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configFile);
  } catch (error) {
    console.error('Error loading config:', error);
    return { mcpServers: {} };
  }
}

// Initialize MCP client
async function initializeMCPClient(name, config) {
  try {
    console.log(`Starting ${name} MCP Server...`);

    // Create transport
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: { ...process.env, ...config.env }
    });

    // Create client
    const client = new Client(
      {
        name: `proxy-${name}-client`,
        version: "1.0.0"
      },
      {
        capabilities: {
          tools: {}  // We're only interested in tools
        }
      }
    );

    // Connect client
    await client.connect(transport);
    console.log(`${name} MCP Server connected`);

    // Wait for server initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get available tools with their schemas
    const response = await client.listTools();
    if (response && response.tools) {
      console.log(`${name} MCP Server tools loaded:`, response.tools.length);
      
      // Store tools with their schemas
      const toolsWithSchemas = response.tools.map(tool => ({
        ...tool,
        outputSchema: tool.outputSchema || {
          type: 'object',
          properties: {
            toolResult: {
              type: 'object',
              properties: {
                content: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      text: { type: 'string' }
                    }
                  }
                },
                isError: { type: 'boolean' }
              }
            }
          }
        }
      }));
      
      mcpClients.set(name, { 
        client, 
        tools: toolsWithSchemas
      });
      
      return { client, tools: toolsWithSchemas };
    } else {
      console.log(`${name} MCP Server responded but no tools found`);
      mcpClients.set(name, { client, tools: [] });
      return { client, tools: [] };
    }
  } catch (error) {
    console.error(`Failed to initialize MCP client ${name}:`, error);
    return null;
  }
}

// Initialize all MCP clients
async function initializeClients() {
  const config = await loadConfig();
  console.log('Loading MCP servers from config:', Object.keys(config.mcpServers));
  
  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    try {
      await initializeMCPClient(name, serverConfig);
    } catch (error) {
      console.error(`Failed to start ${name}:`, error);
    }
  }
}

// Handle WebSocket connections
wss.on('connection', function connection(ws) {
  log('CONNECTION', 'New client connected');

  // Send initial tools list
  const allTools = Array.from(mcpClients.entries()).flatMap(([serverName, { tools }]) => 
    (tools || []).map(tool => ({
      ...tool,
      serverName
    }))
  );
  
  log('TOOLS_INIT', 'Sending initial tools list', { toolCount: allTools.length });
  ws.send(JSON.stringify({
    type: 'tools_list',
    tools: allTools
  }));

  ws.on('message', async function incoming(message) {
    try {
      const request = JSON.parse(message);
      log('REQUEST', 'Received ' + request.type + ' request', request);

      switch (request.type) {
        case 'tools_list': {
          const toolsList = [];
          for (const [serverName, clientInfo] of mcpClients.entries()) {
            if (clientInfo.tools) {
              toolsList.push(...clientInfo.tools.map(tool => ({
                ...tool,
                serverName
              })));
            }
          }
          log('TOOLS_LIST', 'Sending tools list', {
            count: toolsList.length,
            servers: Array.from(mcpClients.keys())
          });
          ws.send(JSON.stringify({
            type: 'tools_list',
            tools: toolsList
          }));
          break;
        }

        case 'tool_schema_issue': {
          const { tool, server, issue } = request;
          if (!server) {
            log('SCHEMA_ISSUE', `Tool ${tool} schema issue: ${issue}`, {
              tool,
              issue,
              source: 'validation'
            });
          } else {
            log('SCHEMA_ISSUE', `Tool ${tool} on server ${server} has schema issue: ${issue}`, {
              tool,
              server,
              issue,
              source: 'server'
            });
          }
          break;
        }

        case 'call_tool': {
          const { serverName, toolName, args, requestId } = request;
          let toolResponse = null;
          let responseContent = null;

          try {
            log('TOOL_CALL', `Calling tool ${toolName} on server ${serverName}`, { args });

            const clientInfo = mcpClients.get(serverName);
            if (!clientInfo) {
              throw new Error(`Server ${serverName} not found`);
            }

            toolResponse = await clientInfo.client.callTool({
              name: toolName,
              arguments: args
            });

            log('TOOL_DEBUG', 'Raw tool response', {
              toolName,
              response: toolResponse,
              hasToolResult: !!toolResponse?.toolResult,
              hasContent: !!toolResponse?.toolResult?.content,
              type: typeof toolResponse
            });

            // Extract content from tool response
            let responseContent;
            
            if (toolResponse?.toolResult?.content) {
              // Tool returns MCP format, extract just the content array
              responseContent = toolResponse.toolResult.content;
            } else if (typeof toolResponse === 'string') {
              // Plain string response
              responseContent = [{
                type: "text",
                text: toolResponse
              }];
            } else {
              // Other response types
              responseContent = [{
                type: "text",
                text: JSON.stringify(toolResponse)
              }];
            }

            log('RESPONSE_DEBUG', 'Formatted response', responseContent);

            // Send response back to client
            ws.send(JSON.stringify({
              type: 'tool_response',
              id: requestId,
              response: responseContent  // Send raw response
            }));
          } catch (error) {
            log('TOOL_ERROR', `Tool ${toolName} execution failed`, {
              error: error.message,
              toolResponse: toolResponse || 'No response received',
              responseContent: responseContent || 'No content formatted'
            });
            
            // Send error response
            ws.send(JSON.stringify({
              type: 'error',
              requestId,
              error: error.message
            }));
          }
          break;
        }

        default:
          throw new Error(`Unknown request type: ${request.type}`);
      }
    } catch (error) {
      log('ERROR', 'Request processing failed', { error: error.message });
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  });

  ws.on('close', () => {
    log('CONNECTION', 'Client disconnected');
  });
});

// Cleanup function to disconnect all clients
async function cleanup() {
  for (const { client } of mcpClients.values()) {
    try {
      await client.disconnect();
    } catch (error) {
      console.error('Error disconnecting client:', error);
    }
  }
  process.exit(0);
}

// Handle process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start the server
console.log('Starting MCP proxy server...');
await initializeClients();
console.log('MCP proxy server running on port 3001');
