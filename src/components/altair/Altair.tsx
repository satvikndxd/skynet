/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { type FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { useEffect, useRef, useState, memo } from "react";
import vegaEmbed from "vega-embed";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import { ToolCall, LiveConfig } from "../../multimodal-live-types";
import { Tool } from "../../lib/mcp-client-manager";

// Validate if a tool's schema is compatible with Gemini
function isValidToolSchema(tool: Tool): boolean {
  // Must have inputSchema with properties
  if (!tool.inputSchema?.properties) {
    console.log(`Tool ${tool.name} skipped: Missing inputSchema or properties`);
    return false;
  }

  // Must have required fields defined (even if empty)
  if (!Array.isArray(tool.inputSchema.required)) {
    console.log(`Tool ${tool.name} skipped: Missing or invalid required fields`);
    return false;
  }

  // All properties must have type
  const hasValidProperties = Object.entries(tool.inputSchema.properties).every(([key, prop]: [string, any]) => {
    if (!prop.type) {
      console.log(`Tool ${tool.name} skipped: Property ${key} missing type`);
      return false;
    }

    // For array types, validate items
    if (prop.type === 'array' && prop.items) {
      if (!prop.items.type) {
        console.log(`Tool ${tool.name} skipped: Array items missing type in property ${key}`);
        return false;
      }
      
      // If items are objects, they must have properties and required fields
      if (prop.items.type === 'object') {
        if (!prop.items.properties || !Array.isArray(prop.items.required)) {
          console.log(`Tool ${tool.name} skipped: Invalid object items in array property ${key}`);
          return false;
        }
      }
    }

    return true;
  });

  if (!hasValidProperties) {
    return false;
  }

  return true;
}

// Convert MCP tool to Gemini function declaration
function convertToolToFunctionDeclaration(tool: Tool): FunctionDeclaration {
  console.log(`Converting tool ${tool.name}:`, JSON.stringify(tool.inputSchema, null, 2));
  
  if (!tool.inputSchema?.properties) {
    return {
      name: tool.name,
      description: tool.description || '',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: []
      }
    };
  }

  const convertedProperties: Record<string, any> = {};
  
  Object.entries(tool.inputSchema.properties).forEach(([key, prop]: [string, any]) => {
    console.log(`Converting property ${key}:`, JSON.stringify(prop, null, 2));
    
    if (prop.type === 'array') {
      convertedProperties[key] = {
        type: SchemaType.ARRAY,
        items: {
          type: prop.items?.type === 'string' ? SchemaType.STRING : 
                prop.items?.type === 'number' ? SchemaType.NUMBER :
                prop.items?.type === 'boolean' ? SchemaType.BOOLEAN :
                prop.items?.type === 'object' ? SchemaType.OBJECT :
                SchemaType.STRING
        },
        description: prop.description || ''
      };
      
      // Handle array of objects
      if (prop.items?.properties) {
        convertedProperties[key].items.properties = Object.entries(prop.items.properties).reduce<Record<string, any>>((acc, [subKey, subProp]: [string, any]) => {
          acc[subKey] = {
            type: subProp.type === 'string' ? SchemaType.STRING :
                  subProp.type === 'number' ? SchemaType.NUMBER :
                  subProp.type === 'boolean' ? SchemaType.BOOLEAN :
                  SchemaType.OBJECT,
            description: subProp.description || ''
          };
          return acc;
        }, {});
        convertedProperties[key].items.required = prop.items.required || [];
      }
    } else {
      convertedProperties[key] = {
        type: prop.type === 'string' ? SchemaType.STRING :
              prop.type === 'number' ? SchemaType.NUMBER :
              prop.type === 'boolean' ? SchemaType.BOOLEAN :
              SchemaType.OBJECT,
        description: prop.description || ''
      };
    }
  });

  const result = {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: convertedProperties,
      required: tool.inputSchema.required || []
    }
  };

  console.log(`Converted result for ${tool.name}:`, JSON.stringify(result, null, 2));
  return result;
}

// Send tool schema issues to server
function logToolSchemaIssue(ws: WebSocket | null, tool: Tool, issue: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'client_log',
      message: `Tool Schema Issue: ${tool.name}`,
      data: {
        tool: tool.name,
        server: tool.serverName,
        issue,
        schema: tool.inputSchema
      }
    }));
  }
}

function AltairComponent() {
  const [jsonString, setJSONString] = useState<string>("");
  const { client, setConfig } = useLiveAPIContext();
  const [mcpTools, setMcpTools] = useState<Tool[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const embedRef = useRef<HTMLDivElement>(null);

  // Connect to MCP server and get tools
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001');
    setWs(ws);

    ws.onopen = () => {
      console.log('Connected to MCP server, requesting tools...');
      ws.send(JSON.stringify({ type: 'tools_list' }));
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket connection closed');
    };

    ws.onmessage = (event) => {
      console.log('Received WebSocket message:', event.data);
      const data = JSON.parse(event.data);
      console.log('Parsed message data:', data);

      if (data.type === 'tools_list') {
        if (!Array.isArray(data.tools)) {
          console.error('Invalid tools data:', data);
          return;
        }
        console.log('Received MCP tools:', JSON.stringify(data.tools, null, 2));
        setMcpTools(data.tools);
      } else if (data.type === 'tool_response') {
        console.log('Received tool response:', data);
        client.sendToolResponse({
          functionResponses: [{
            response: data.response,
            id: data.id
          }]
        });
      } else if (data.type === 'error') {
        console.error('Received error from server:', data.error);
      }
    };

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [client]);

  // Update Gemini config when MCP tools are loaded
  useEffect(() => {
    console.log('mcpTools changed:', mcpTools);
    if (mcpTools.length === 0) {
      console.log('No MCP tools available yet');
      return;
    }

    console.log('Total tools:', mcpTools.length);
    console.log('Tools by server:');
    const byServer = mcpTools.reduce((acc, tool, index) => {
      acc[tool.serverName] = acc[tool.serverName] || [];
      acc[tool.serverName].push({ ...tool, index });
      return acc;
    }, {} as Record<string, any[]>);
    console.log(byServer);

    // Check each tool's schema and log issues
    mcpTools.forEach(tool => {
      if (!tool.inputSchema?.$schema) {
        logToolSchemaIssue(ws, tool, 'Missing $schema field in inputSchema');
      }
      if (tool.inputSchema?.additionalProperties === undefined) {
        logToolSchemaIssue(ws, tool, 'Missing additionalProperties field in inputSchema');
      }
    });

    // Skip tools that don't have the full schema structure
    const lastFilesystemTool = mcpTools.findIndex(tool => 
      tool.serverName === 'filesystem' && !tool.inputSchema?.$schema);
    console.log('Last filesystem tool without schema:', lastFilesystemTool);

    // Take all tools except the problematic ones
    const selectedTools = [
      ...mcpTools.slice(0, lastFilesystemTool), // Tools before the problematic one
      ...mcpTools.slice(lastFilesystemTool + 1, mcpTools.length - 1) // Remaining tools except last
    ];
    console.log('Selected tools:', selectedTools.map(t => ({
      name: t.name,
      server: t.serverName,
      schema: t.inputSchema
    })));

    // Convert selected tools into function declarations
    const functionDeclarations = selectedTools.map((tool: Tool) => {
      console.log(`Converting tool ${tool.name} from ${tool.serverName}`);
      const declaration = convertToolToFunctionDeclaration(tool);
      console.log(`Converted ${tool.name} to:`, declaration);
      return declaration;
    });

    const config: LiveConfig = {
      model: "models/gemini-2.0-flash-exp",
      generationConfig: {
        responseModalities: "audio",
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
        },
      },
      systemInstruction: {
        parts: [
          {
            text: `You are my helpful assistant. You have access to these tools for reading, writing, listing, searching, and managing files and directories. When I ask about file operations, use these tools to help me. Use the tools intelligently. and avoid asking for additional information unless required, just make your best judgment based on the tools available. for example, you only have access to specific directories to make changes, so use the tools to find that out first and then make the changes. same goes for other tools like github tools. first check if a repo exists, then create repo or update repo or create pr. You dont need to follow exactly as I said, just use your best judgement.`,
          },
        ],
      },
      tools: [
        { googleSearch: {} },
        { functionDeclarations: functionDeclarations }
      ],
    };

    console.log('Final config being sent to Gemini:', {
      model: config.model,
      tools: config.tools,
      functionDeclarations: functionDeclarations.map(fd => ({
        name: fd.name,
        params: fd.parameters
      }))
    });
    
    setConfig(config);
  }, [setConfig, mcpTools, ws]);

  // Handle tool calls
  useEffect(() => {
    const onToolCall = (toolCall: ToolCall) => {
      console.log(`Received tool call from Gemini:`, toolCall);

      // Handle each function call
      toolCall.functionCalls.forEach((fc) => {
        // Find the corresponding MCP tool
        const mcpTool = mcpTools.find(tool => tool.name === fc.name);
        if (!mcpTool) {
          console.error(`Tool ${fc.name} not found in MCP tools`);
          client.sendToolResponse({
            functionResponses: [{
              response: { error: `Tool ${fc.name} not found` },
              id: fc.id
            }]
          });
          return;
        }

        // Convert Gemini args to MCP format
        const mcpRequest = {
          type: 'call_tool',
          toolName: mcpTool.name,
          serverName: mcpTool.serverName,
          args: fc.args,
          requestId: fc.id
        };

        console.log('Sending MCP tool request:', JSON.stringify(mcpRequest, null, 2));
        
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(mcpRequest));
        } else {
          console.error('WebSocket is not open');
          client.sendToolResponse({
            functionResponses: [{
              response: { error: 'WebSocket connection is not available' },
              id: fc.id
            }]
          });
        }
      });
    };

    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [client, mcpTools, ws]);

  useEffect(() => {
    if (embedRef.current && jsonString) {
      vegaEmbed(embedRef.current, JSON.parse(jsonString));
    }
  }, [embedRef, jsonString]);

  return <div className="vega-embed" ref={embedRef} />;
}

export const Altair = memo(AltairComponent);
