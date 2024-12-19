import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, '../../mcp-config.json');

async function loadConfig() {
  try {
    const configFile = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configFile);
  } catch (error) {
    console.error('Error loading config:', error);
    return { mcpServers: {} };
  }
}

async function testMCPServer(name, config) {
  console.log(`\nTesting ${name} MCP Server...`);
  console.log('Config:', JSON.stringify(config, null, 2));

  // Create transport
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: { ...process.env, ...config.env }
  });

  console.log('Transport created');

  // Create client
  const client = new Client(
    {
      name: `test-${name}-client`,
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {}  // Explicitly request tools capability
      }
    }
  );

  console.log('Client created, connecting...');

  try {
    // Connect client
    await client.connect(transport);
    console.log(`${name} MCP Server connected`);

    // Get server capabilities
    const capabilities = client.getServerCapabilities();
    console.log('Server capabilities:', capabilities);

    // List tools
    console.log('\nListing tools...');
    const toolsResponse = await client.listTools();
    console.log('Tools:', JSON.stringify(toolsResponse, null, 2));

    // // If we got tools, try to call the first one
    // if (toolsResponse && toolsResponse.tools && toolsResponse.tools.length > 0) {
    //   const firstTool = toolsResponse.tools[0];
    //   console.log(`\nTrying to call tool: ${firstTool.name}`);
    //   console.log('Tool schema:', JSON.stringify(firstTool.schema, null, 2));
      
    //   try {
    //     const result = await client.callTool({
    //       name: firstTool.name,
    //       arguments: {}  // We'd need to provide proper arguments based on the tool's schema
    //     });
    //     console.log('Tool call result:', JSON.stringify(result, null, 2));
    //   } catch (error) {
    //     console.error('Error calling tool:', error.message);
    //   }
    // }

    // Disconnect
    console.log(`\n${name} MCP Server disconnected`);
  } catch (error) {
    console.error(`Error testing ${name} MCP Server:`, error);
  }
}

async function main() {
  const config = await loadConfig();
  console.log('Testing MCP servers from config:', Object.keys(config.mcpServers));

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    await testMCPServer(name, serverConfig);
  }
}

main().catch(console.error);
