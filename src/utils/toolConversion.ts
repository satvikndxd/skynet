import { SchemaType } from "@google/generative-ai";

export interface Tool {
  name: string;
  description: string;
  serverName: string;
  inputSchema?: {
    $schema?: string;
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: SchemaType;
    properties: Record<string, any>;
    required: string[];
  };
}

export function convertToolToFunctionDeclaration(tool: Tool): FunctionDeclaration {
  console.log(`Converting tool ${tool.name}:`, JSON.stringify(tool.inputSchema, null, 2));
  
  // Clean up description
  const cleanDescription = (desc: string) => desc?.replace(/['"`]/g, '') || '';
  
  if (!tool.inputSchema?.properties) {
    return {
      name: tool.name,
      description: cleanDescription(tool.description),
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
        description: cleanDescription(prop.description)
      };
      
      // Handle array of objects
      if (prop.items?.properties) {
        convertedProperties[key].items.properties = Object.entries(prop.items.properties).reduce<Record<string, any>>((acc, [subKey, subProp]: [string, any]) => {
          acc[subKey] = {
            type: subProp.type === 'string' ? SchemaType.STRING :
                  subProp.type === 'number' ? SchemaType.NUMBER :
                  subProp.type === 'boolean' ? SchemaType.BOOLEAN :
                  SchemaType.OBJECT,
            description: cleanDescription(subProp.description)
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
        description: cleanDescription(prop.description)
      };
    }
  });

  const result = {
    name: tool.name,
    description: cleanDescription(tool.description),
    parameters: {
      type: SchemaType.OBJECT,
      properties: convertedProperties,
      required: tool.inputSchema.required || []
    }
  };

  console.log(`Converted result for ${tool.name}:`, JSON.stringify(result, null, 2));
  return result;
}

export function filterAndConvertTools(tools: Tool[]): FunctionDeclaration[] {
  // Filter out tools that don't have proper schema
  const validTools = tools.filter(tool => {
    // Skip tools without proper schema
    if (!tool.inputSchema?.properties) {
      console.log(`Skipping tool ${tool.name}: No schema properties`);
      return false;
    }

    // Skip specific server tools that might cause issues
    const skipServers = ['filesystem', 'docker-mcp'];
    if (skipServers.includes(tool.serverName)) {
      console.log(`Skipping tool ${tool.name} from server ${tool.serverName}`);
      return false;
    }

    return true;
  });

  console.log('Selected tools:', validTools.map(t => ({
    name: t.name,
    server: t.serverName,
    schema: t.inputSchema
  })));

  // Convert valid tools into function declarations
  return validTools.map((tool: Tool) => {
    console.log(`Converting tool ${tool.name} from ${tool.serverName}`);
    const declaration = convertToolToFunctionDeclaration(tool);
    console.log(`Converted ${tool.name} to:`, declaration);
    return declaration;
  });
}

export function logToolSchemaIssue(ws: WebSocket | null, tool: Tool, issue: string) {
  console.log(`Schema issue for tool ${tool.name} from server ${tool.serverName}: ${issue}`);
  if (ws) {
    ws.send(JSON.stringify({
      type: 'tool_schema_issue',
      tool: tool.name,
      server: tool.serverName,
      issue
    }));
  }
}
