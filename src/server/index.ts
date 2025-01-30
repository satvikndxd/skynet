import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import http from 'http';
import puppeteer from 'puppeteer';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../build')));

const sessions = new Map();

const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY!);

wss.on('connection', async (ws) => {
  ws.on('message', async (message) => {
    const data = JSON.parse(message.toString());
    
    switch (data.type) {
      case 'create_session':
        try {
          const browser = await puppeteer.launch({ 
            headless: false,
            args: ['--no-sandbox']
          });
          const page = await browser.newPage();
          const sessionId = Math.random().toString(36).substring(7);
          sessions.set(sessionId, { browser, page });
          ws.send(JSON.stringify({ sessionId }));
        } catch (error) {
          ws.send(JSON.stringify({ error: 'Failed to create session' }));
        }
        break;

      case 'navigate':
        try {
          const session = sessions.get(data.sessionId);
          if (session) {
            await session.page.goto(data.url);
            ws.send(JSON.stringify({ success: true }));
          }
        } catch (error) {
          ws.send(JSON.stringify({ error: 'Failed to navigate' }));
        }
        break;

      case 'screenshot':
        try {
          const session = sessions.get(data.sessionId);
          if (session) {
            const screenshot = await session.page.screenshot({ 
              encoding: 'base64',
              fullPage: data.fullPage 
            });
            ws.send(JSON.stringify({ image: `data:image/png;base64,${screenshot}` }));
          }
        } catch (error) {
          ws.send(JSON.stringify({ error: 'Failed to take screenshot' }));
        }
        break;

      case 'analyze':
        try {
          const session = sessions.get(data.sessionId);
          if (session) {
            const screenshot = await session.page.screenshot({ 
              encoding: 'base64',
              fullPage: data.fullPage 
            });
            
            const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
            const prompt = data.prompt || "Analyze this webpage and describe what you see";
            
            const result = await model.generateContent([
              prompt,
              {
                inlineData: {
                  data: screenshot.toString('base64'),
                  mimeType: "image/png"
                },
              },
            ]);
            
            const response = await result.response;
            ws.send(JSON.stringify({ 
              type: 'analysis',
              text: response.text() 
            }));
          }
        } catch (error) {
          ws.send(JSON.stringify({ error: 'Failed to analyze page' }));
        }
        break;
    }
  });
});

app.get('/session/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  if (sessions.has(sessionId)) {
    res.json({ status: 'active' });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../build/index.html'));
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`WebSocket server running at ws://localhost:${port}`);
});

process.on('SIGINT', async () => {
  for (const session of sessions.values()) {
    await session.browser.close();
  }
  process.exit();
});