import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

interface AnalysisOptions {
  mode: 'general' | 'detail' | 'summary' | 'custom';
  customPrompt?: string;
}

const useGeminiAPI = () => {
  const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY!);
  let model: GenerativeModel;

  const getPromptForMode = (mode: string, url: string, customPrompt?: string) => {
    switch (mode) {
      case 'detail':
        return `Provide a detailed analysis of this webpage at ${url}. Include information about the layout, main content, and key features.`;
      case 'summary':
        return `Give me a brief summary of what you see on this webpage at ${url}.`;
      case 'custom':
        return customPrompt || '';
      default:
        return `Analyze this webpage at ${url} and tell me what you see.`;
    }
  };

  const analyzeImage = async (imageBase64: string, url: string, options: AnalysisOptions) => {
    try {
      if (!model) {
        model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
      }

      const prompt = getPromptForMode(options.mode, url, options.customPrompt);

      const imageParts = [
        {
          inlineData: {
            data: imageBase64.split(',')[1],
            mimeType: "image/jpeg"
          },
        },
      ];

      const result = await model.generateContent([prompt, ...imageParts]);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Error analyzing image:', error);
      throw error;
    }
  };

  return { analyzeImage };
};

export default useGeminiAPI;