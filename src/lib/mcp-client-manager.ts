import { MCPServerConfig } from "../config/mcp-config";

export interface Tool {
  name: string;
  description: string;
  serverName: string;
  inputSchema: {
    type: string;
    properties: Record<string, {
      type: string;
      items?: { type: string };
      description?: string;
    }>;
    required?: string[];
    additionalProperties?: boolean;
    $schema?: string;
  };
}

export interface MCPClientInfo {
  tools: Tool[];
}

export type MCPClients = Record<string, MCPClientInfo>;

class MCPWebSocketClient {
  private ws: WebSocket;
  private messageHandlers = new Map<string, (response: any) => void>();
  private toolsUpdateCallback: ((tools: Tool[]) => void) | null = null;
  private connected = false;
  private messageQueue: any[] = [];
  
  constructor() {
    this.ws = new WebSocket('ws://localhost:3001');
    
    this.ws.onopen = () => {
      this.connected = true;
      // Process any queued messages
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift();
        if (msg) {
          this.ws.send(JSON.stringify(msg));
        }
      }
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'tools_list':
          if (this.toolsUpdateCallback) {
            this.toolsUpdateCallback(message.tools);
          }
          break;
          
        case 'tool_response':
          const handler = this.messageHandlers.get(message.requestId);
          if (handler) {
            handler(message.response);
            this.messageHandlers.delete(message.requestId);
          }
          break;
          
        case 'error':
          console.error('MCP server error:', message.error);
          break;
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      this.connected = false;
      console.log('WebSocket connection closed');
    };
  }

  private sendOrQueue(message: any) {
    if (this.connected) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  onToolsUpdate(callback: (tools: Tool[]) => void) {
    this.toolsUpdateCallback = callback;
    // Request tools list when callback is set
    this.sendOrQueue({ type: 'list_tools' });
  }

  async callTool(serverName: string, toolName: string, args: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(7);
      
      this.messageHandlers.set(requestId, resolve);
      
      this.sendOrQueue({
        type: 'call_tool',
        requestId,
        serverName,
        toolName,
        args
      });
    });
  }
}

// Single instance of the WebSocket client
const wsClient = new MCPWebSocketClient();

export async function createMCPClient(name: string, config: MCPServerConfig): Promise<MCPClientInfo> {
  return new Promise((resolve) => {
    wsClient.onToolsUpdate((tools) => {
      resolve({ tools });
    });
  });
}

export async function callMCPTool(serverName: string, toolName: string, args: any): Promise<any> {
  return wsClient.callTool(serverName, toolName, args);
}
