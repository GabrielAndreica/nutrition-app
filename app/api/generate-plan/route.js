import { OpenAI } from 'openai';

console.log('OPENAI_API_KEY check:', process.env.OPENAI_API_KEY ? 'SET (length: ' + process.env.OPENAI_API_KEY.length + ')' : 'NOT SET');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request) {
  try {
    const body = await request.json();
    
    const {
      name,
      age,
      weight,
      height,
      goal,
      activityLevel,
      allergies,
      mealsPerDay,
      dietType,
    } = body;

    // Validate required fields
    if (!name || !age || !weight || !height || !goal || !activityLevel || !mealsPerDay) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create the prompt for meal plan generation
    const prompt = `Generate a 1-day meal plan for:
- Name: ${name}
- Age: ${age}
- Weight: ${weight} kg
- Height: ${height} cm
- Goal: ${goal}
- Activity Level: ${activityLevel}
- Allergies/Restrictions: ${allergies || 'None'}
- Meals Per Day: ${mealsPerDay}
- Diet Type: ${dietType || 'Balanced'}

Provide a SIMPLE meal plan with clear structure. List the meals with foods and basic nutrition info.

Example format:
MEAL PLAN FOR TODAY

Breakfast: Oatmeal with berries - Calories: 350, Protein: 10g, Carbs: 50g, Fat: 8g
Lunch: Grilled chicken with rice - Calories: 550, Protein: 40g, Carbs: 60g, Fat: 12g
Dinner: Salmon with vegetables - Calories: 450, Protein: 35g, Carbs: 35g, Fat: 15g
Daily Total: Calories: 1350, Protein: 85g, Carbs: 145g, Fat: 35g`;

    // Call OpenAI API
    let message;
    try {
      console.log('Starting OpenAI API call...');
      message = await Promise.race([
        openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('OpenAI API timeout after 30s')), 30000)
        )
      ]);
      console.log('OpenAI API call successful');
    } catch (openaiError) {
      console.error('=== OpenAI API Error ===');
      console.error('Error type:', openaiError.constructor.name);
      console.error('Error message:', openaiError.message);
      console.error('Full error object:', openaiError);
      
      // Try to get status code if available
      if (openaiError.status) {
        console.error('HTTP Status:', openaiError.status);
      }
      if (openaiError.error) {
        console.error('Error.error:', openaiError.error);
      }
      
      return new Response(
        JSON.stringify({ 
          error: 'OpenAI API Error',
          details: openaiError.message,
          type: openaiError.constructor.name,
          hint: 'Check if API key is valid and OpenAI service is accessible'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Extract the response content
    const responseContent = message.choices[0].message.content;

    if (!responseContent) {
      return new Response(
        JSON.stringify({ error: 'Empty response from AI' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('Parsing response, length:', responseContent.length);
    console.log('Response preview:', responseContent.substring(0, 300));

    // Parse the meal plan text response
    const meals = [];
    const lines = responseContent.split('\n').filter(line => line.trim());
    console.log('Found', lines.length, 'lines');
    
    for (const line of lines) {
      if (line.match(/Breakfast|Lunch|Dinner|Snack/i)) {
        const mealMatch = line.match(/(Breakfast|Lunch|Dinner|Snack):\s*(.+?)\s*-\s*Calories:\s*(\d+)/i);
        if (mealMatch) {
          const [, mealType, foods, calories] = mealMatch;
          
          // Try to extract macros
          const proteinMatch = line.match(/Protein:\s*(\d+)/i);
          const carbsMatch = line.match(/Carbs:\s*(\d+)/i);
          const fatMatch = line.match(/Fat:\s*(\d+)/i);

          meals.push({
            mealType: mealType.charAt(0).toUpperCase() + mealType.slice(1),
            foods: [foods.trim()],
            calories: parseInt(calories),
            protein: proteinMatch ? parseInt(proteinMatch[1]) : 0,
            carbs: carbsMatch ? parseInt(carbsMatch[1]) : 0,
            fat: fatMatch ? parseInt(fatMatch[1]) : 0,
          });
        }
      }
    }

    // Extract daily totals
    const totalLine = responseContent.match(/Daily Total:.*?Calories:\s*(\d+).*?Protein:\s*(\d+).*?Carbs:\s*(\d+).*?Fat:\s*(\d+)/i);
    
    const dailyTotals = totalLine ? {
      calories: parseInt(totalLine[1]),
      protein: parseInt(totalLine[2]),
      carbs: parseInt(totalLine[3]),
      fat: parseInt(totalLine[4]),
    } : {
      calories: meals.reduce((sum, m) => sum + m.calories, 0),
      protein: meals.reduce((sum, m) => sum + m.protein, 0),
      carbs: meals.reduce((sum, m) => sum + m.carbs, 0),
      fat: meals.reduce((sum, m) => sum + m.fat, 0),
    };

    const mealPlan = {
      clientName: name,
      goal,
      day: 1,
      date: new Date().toISOString().split('T')[0],
      meals: meals.length > 0 ? meals : [
        {
          mealType: "Breakfast",
          foods: ["Oatmeal with berries"],
          calories: 350,
          protein: 10,
          carbs: 50,
          fat: 8
        },
        {
          mealType: "Lunch",
          foods: ["Grilled chicken with rice"],
          calories: 550,
          protein: 40,
          carbs: 60,
          fat: 12
        },
        {
          mealType: "Dinner",
          foods: ["Salmon with vegetables"],
          calories: 450,
          protein: 35,
          carbs: 35,
          fat: 15
        }
      ],
      dailyTotals
    };

    return new Response(JSON.stringify(mealPlan), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error generating meal plan:', error);
    console.error('Error stack:', error.stack);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to generate meal plan',
        details: error.message,
        stack: error.stack?.substring(0, 200)
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
