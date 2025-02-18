import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai";

const API_KEY = "AIzaSyDJ4UcQQzGv7x7fVocx5lOPcSCCsb4dQmQ"; // 我知道寫在前端很糟糕但我真的懶得搞一個後端！！！
// Initialize Gemini API
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-thinking-exp-01-21",
    generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.2,
        topP: 0.8,
        topK: 20,
    },
    systemInstruction: "使用正體中文（臺灣）回答。回答我的提問，我的提問內容會是基於我提問後面所附的題目，但那個題目並非你主要要回答的內容。Simplified Chinese and pinyin are STRICTLY PROHIBITED. Do not include any introductory phrases or opening remarks.",
});

// Define the generateExplanation function and expose it globally
window.generateExplanation = async function(question, options, userQuestion) {
const prompt = `針對以下問題，${userQuestion}

${question} 
${Object.entries(options).map(([key, value]) => `${key}: ${value}`).join('\n')}`;

    try {
        // Call generateContent
        const result = await model.generateContent([prompt]);

        // Log AI response for debugging
        console.log('AI Response:', result);

        // Extract text from response
        if (result && result.response) {
            const text = await result.response.text();
            return text.trim();
        } else {
            throw new Error("AI response format is incorrect.");
        }
    } catch (error) {
        console.error('Error fetching AI response:', error);
        throw new Error("An error occurred while generating the explanation.");
    }
};
