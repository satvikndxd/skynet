import EventEmitter from 'eventemitter3';

class BrowserbaseServer extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;

  constructor() {
    super();
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket('ws://localhost:3001');
    
    this.ws.onopen = () => {
      console.log('Connected to Browserbase server');
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.emit('message', data);
    };

    this.ws.onerror = (error) => {
      console.error('Browserbase WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('Disconnected from Browserbase server');
      setTimeout(() => this.connect(), 5000);
    };
  }

  async createSession() {
    if (!this.ws) throw new Error('WebSocket not connected');
    this.ws.send(JSON.stringify({ type: 'create_session' }));
  }

  async navigate(url: string) {
    if (!this.ws) throw new Error('WebSocket not connected');
    this.ws.send(JSON.stringify({ type: 'navigate', url }));
  }

  async screenshot(selector: string = 'body', fullPage: boolean = true) {
    if (!this.ws) throw new Error('WebSocket not connected');
    this.ws.send(JSON.stringify({ 
      type: 'screenshot', 
      selector,
      fullPage
    }));
  }

  async analyzePage(sessionId: string, prompt?: string, fullPage: boolean = true) {
    this.sendMessage({ 
      type: 'analyze',
      sessionId,
      prompt,
      fullPage
    });
  }
}

export const browserbaseServer = new BrowserbaseServer();