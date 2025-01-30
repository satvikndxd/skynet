import React, { useState, useEffect, useCallback } from 'react';
import useGeminiAPI from '../../hooks/useGeminiAPI';
import { browserbaseServer } from '../../lib/browserbase-server';
import './BrowserbaseVision.scss';

interface BrowserSession {
  id: string;
  url: string;
  iframeUrl?: string;
}

const BrowserbaseVision: React.FC = () => {
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<string>('');
  const [analysisMode, setAnalysisMode] = useState<'general' | 'detail' | 'summary' | 'custom'>('general');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [url, setUrl] = useState<string>('');
  const { analyzeImage } = useGeminiAPI();

  const handleScreenshot = async (imageBase64: string) => {
    try {
      setLoading(true);
      const result = await analyzeImage(imageBase64, url, {
        mode: analysisMode,
        customPrompt: customPrompt
      });
      setAnalysis(result);
    } catch (error) {
      console.error('Screenshot analysis failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBrowserbaseMessage = useCallback((data: any) => {
    if (data.type === 'analysis') {
      setAnalysis(data.text);
      setLoading(false);
    }
    if (data.sessionId) {
      setSession({ 
        id: data.sessionId, 
        url: '', 
        iframeUrl: `http://localhost:3001/session/${data.sessionId}` 
      });
      setLoading(false);
    }
    
    if (data.image) {
      handleScreenshot(data.image);
    }

    if (data.error) {
      console.error('Browserbase error:', data.error);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    browserbaseServer.on('message', handleBrowserbaseMessage);
    createSession();
    return () => {
      browserbaseServer.off('message', handleBrowserbaseMessage);
    };
  }, [handleBrowserbaseMessage]);

  const createSession = async () => {
    try {
      setLoading(true);
      await browserbaseServer.createSession();
    } catch (error) {
      console.error('Failed to create browser session:', error);
      setLoading(false);
    }
  };

  const navigateToUrl = async (targetUrl: string) => {
    if (!session) return;
    try {
      setLoading(true);
      await browserbaseServer.navigate(targetUrl);
      setSession({ ...session, url: targetUrl });
    } catch (error) {
      console.error('Failed to navigate:', error);
      setLoading(false);
    }
  };

  const captureAndAnalyze = async () => {
    if (!session) return;
    try {
      setLoading(true);
      const prompt = analysisMode === 'custom' ? customPrompt : undefined;
      await browserbaseServer.analyzePage(session.id, prompt);
    } catch (error) {
      console.error('Failed to analyze page:', error);
      setLoading(false);
    }
  };

  return (
    <div className="browserbase-vision">
      <div className="controls">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Enter URL"
          onKeyDown={(e) => e.key === 'Enter' && navigateToUrl(url)}
        />
        <button onClick={() => navigateToUrl(url)}>Go</button>
        <select
          value={analysisMode}
          onChange={(e) => setAnalysisMode(e.target.value as any)}
        >
          <option value="general">General Analysis</option>
          <option value="detail">Detailed Analysis</option>
          <option value="summary">Summary</option>
          <option value="custom">Custom Prompt</option>
        </select>
        {analysisMode === 'custom' && (
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Enter custom prompt"
          />
        )}
        <button onClick={captureAndAnalyze} disabled={loading}>
          {loading ? 'Analyzing...' : 'Analyze Page'}
        </button>
      </div>

      <div className="browser-container">
        {session?.iframeUrl ? (
          <iframe
            src={session.iframeUrl}
            title="Browser Session"
            className="browser-frame"
          />
        ) : (
          <div className="browser-placeholder">
            {loading ? 'Loading browser...' : 'No browser session'}
          </div>
        )}
      </div>

      {analysis && (
        <div className="analysis-results">
          <h3>Analysis Results</h3>
          <pre>{analysis}</pre>
        </div>
      )}
    </div>
  );
};

export default BrowserbaseVision;