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
import { ToolCall } from "../../multimodal-live-types";
import { Tool } from "../../lib/mcp-client-manager";

// Convert MCP tool to Gemini function declaration
function convertMCPToolToFunctionDeclaration(tool: Tool): FunctionDeclaration | undefined {
  if (!tool.inputSchema || !tool.inputSchema.properties) {
    console.error('Invalid tool schema:', tool);
    return undefined;
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: Object.entries(tool.inputSchema.properties).reduce((acc, [key, prop]) => {
        acc[key] = {
          type: prop.type === 'array' ? SchemaType.ARRAY : SchemaType.STRING,
          description: prop.description || `Parameter ${key} for ${tool.name}`,
          ...(prop.type === 'array' && prop.items ? {
            items: {
              type: prop.items.type === 'object' ? SchemaType.OBJECT : SchemaType.STRING
            }
          } : {})
        };
        return acc;
      }, {} as Record<string, any>),
      required: tool.inputSchema.required || []
    }
  };
}

function AltairComponent() {
  const [jsonString, setJSONString] = useState<string>("");
  const { client, setConfig } = useLiveAPIContext();
  const [mcpTools, setMcpTools] = useState<Tool[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Connect to MCP server and get tools
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to MCP server');
      ws.send(JSON.stringify({ type: 'list_tools' }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'tools_list') {
        setMcpTools(data.tools);
      } else if (data.type === 'tool_response') {
        client.sendToolResponse({
          functionResponses: [{
            response: data.response,
            id: data.requestId
          }]
        });
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  // Update Gemini config when MCP tools are loaded
  useEffect(() => {
    // Take just the first tool for testing
    if (mcpTools.length === 0) return;

    console.log('First MCP tool:', mcpTools[0]); // Log the original tool

    const testTool = mcpTools[0];
    const testDeclaration = {
      name: testTool.name,
      description: testTool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: Object.entries(testTool.inputSchema.properties).reduce((acc, [key, prop]) => {
          acc[key] = {
            type: SchemaType.STRING,
            description: prop.description || `Parameter ${key} for ${testTool.name}`
          };
          return acc;
        }, {} as Record<string, any>),
        required: testTool.inputSchema.required || []
      }
    };

    console.log('Converted declaration:', testDeclaration); // Log the converted declaration

    setConfig({
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
            text: `You are my helpful assistant. You have access to the following tool:\n- ${testTool.name}: ${testTool.description}`,
          },
        ],
      },
      tools: [
        { googleSearch: {} },
        { functionDeclarations: [testDeclaration] }
      ],
    });
  }, [setConfig, mcpTools]);

  // Handle tool calls
  useEffect(() => {
    const onToolCall = async (toolCall: ToolCall) => {
      console.log('Tool call received:', toolCall);
      
      for (const fc of toolCall.functionCalls) {
        const tool = mcpTools.find(t => t.name === fc.name);
        if (!tool) {
          console.error(`Unknown tool: ${fc.name}`);
          client.sendToolResponse({
            functionResponses: [{
              response: { error: `Unknown tool: ${fc.name}` },
              id: fc.id
            }]
          });
          continue;
        }

        try {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'call_tool',
              serverName: tool.serverName,
              toolName: fc.name,
              args: fc.args,
              requestId: fc.id
            }));
          } else {
            throw new Error('WebSocket connection not available');
          }
        } catch (error) {
          console.error('Error calling tool:', error);
          client.sendToolResponse({
            functionResponses: [{
              response: { error: error instanceof Error ? error.message : 'Unknown error' },
              id: fc.id
            }]
          });
        }
      }
    };

    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [client, mcpTools]);

  const embedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (embedRef.current && jsonString) {
      vegaEmbed(embedRef.current, JSON.parse(jsonString));
    }
  }, [embedRef, jsonString]);

  return <div className="vega-embed" ref={embedRef} />;
}

export const Altair = memo(AltairComponent);
