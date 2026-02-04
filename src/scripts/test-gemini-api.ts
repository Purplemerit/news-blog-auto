import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = 'AIzaSyBuSOQqqkbfz_-zFRiS-R5iJHrlhn0BSe4';

async function testModels() {
  console.log('🔍 Testing Gemini API...\n');
  console.log(`API Key: ${API_KEY.substring(0, 10)}...${API_KEY.substring(API_KEY.length - 4)}\n`);

  const genAI = new GoogleGenerativeAI(API_KEY);

  const modelsToTry = [
    'gemini-pro',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest',
  ];

  for (const modelName of modelsToTry) {
    try {
      console.log(`Testing model: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Say hello!' }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 50,
        },
      });

      const text = result.response.text();
      console.log(`✅ SUCCESS! Model ${modelName} works!`);
      console.log(`   Response: ${text.substring(0, 100)}\n`);
      break; // Found a working model!
    } catch (error: any) {
      console.log(`❌ FAILED: ${error.message}\n`);
    }
  }

  console.log('\n💡 Update your .env file with the working model name.');
}

testModels().catch(console.error);
