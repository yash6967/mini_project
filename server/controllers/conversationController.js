const Conversation = require('../models/Conversation');
const config = require('../config/groq'); // Use Groq config
const localLLM = require('../llm/localLLM');

// Helper function to create system prompt for loan agent training
const createSystemPrompt = (scenario, difficulty, additionalInfo) => {
  let promptTemplate;

  if (difficulty === 'easy') {
    promptTemplate = process.env.PROMPT1;
  } else {
    promptTemplate = process.env.PROMPT2;
  } 

  if (!promptTemplate) {
    console.error(`Prompt not found for difficulty: ${difficulty}. PROMPT1 or PROMPT2 might be missing in .env. Scenario was: ${scenario}`);
    return "You are a customer. Please respond naturally."; // Basic fallback
  }

  let finalPrompt = promptTemplate;
  if (scenario) {
    finalPrompt = finalPrompt.replace(/{scenario}/g, scenario); // Use global replace for multiple occurrences
  }
  if (additionalInfo) {
    finalPrompt = finalPrompt.replace(/{additionalInfo}/g, additionalInfo);
  } else {
    // If additionalInfo is not provided, you might want to replace the placeholder with an empty string or a default message
    finalPrompt = finalPrompt.replace(/{additionalInfo}/g, 'No additional context provided.');
  }
  
  // Fallback for placeholders if not replaced (e.g. if scenario/additionalInfo were null and not caught above)
  finalPrompt = finalPrompt.replace(/{scenario}/g, 'general scenario');
  finalPrompt = finalPrompt.replace(/{additionalInfo}/g, 'No additional context.');

  return finalPrompt;
};

// Helper function to get initial customer message
const getCustomerInitialMessage = (scenario) => {
  // Fallback to general scenario messages
  const generalMessages = {
    'credit-card': "Hello! I'm interested in getting a credit card but I'm not sure which one would be right for me. Could you help?",
    'personal-loan': "Hi, I need some money for my daughter's wedding next month. Could you explain how personal loans work?",
    'business-loan': "Hello, I run a small grocery store and I've been thinking about expanding it, but I'm not really sure how to go about getting a loan for it. Can you help me understand what's involved?",
    'savings': "Hi! I just got my first job and want to start saving money properly. What's the best way to save? I heard something about high-interest accounts?",
    'demat': "Hello, I've been thinking about investing in the stock market, but I'm completely new to this. A friend mentioned I need something called a demat account?",
    'investment': "Hi there! I have some savings that I want to invest wisely. Could you explain my options in simple terms?"
  };
  return generalMessages[scenario] || `Hi, I'm interested in ${scenario} and could use some guidance. Could you explain things in simple terms?`;
};

// Using local LLM simulator instead of external Groq client

// @desc    Start a new conversation with Groq
// @route   POST /api/conversations/start
// @access  Private
exports.startConversation = async (req, res) => {
  try {
    console.log('Starting new conversation with Groq:', {
      user: req.user?.id,
      body: req.body
    });

    const { scenario, difficultyLevel, additionalInfo } = req.body;
    
    // Validate scenario
    const allowedScenarios = [
      'income', 'area', 'insurance', 'credit_score',
      'credit-card', 'personal-loan', 'business-loan',
      'savings', 'demat', 'investment',
      'product-credit-card', 'product-personal-loan', 'product-business-loan',
      'product-savings', 'product-demat', 'product-investment'
    ];
    
    if (!scenario || !allowedScenarios.includes(scenario)) {
      console.log('Invalid scenario provided:', scenario);
      return res.status(400).json({ 
        message: 'Invalid scenario. Must be one of: ' + allowedScenarios.join(', ') 
      });
    }
    
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      console.log('User not authenticated');
      return res.status(401).json({ message: 'Authentication required to start a conversation' });
    }

    // Create initial customer message
    const initialMessage = {
      sender: 'ai',
      content: getCustomerInitialMessage(scenario),
      timestamp: new Date()
    };

    // Create conversation record
    const conversation = new Conversation({
      userId: req.user.id,
      scenario,
      messages: [initialMessage],
      createdAt: new Date(),
      isCompleted: false
    });

    await conversation.save();
    console.log('Conversation saved successfully');

    res.status(201).json({
      conversationId: conversation._id,
      messages: [initialMessage],
      sessionInfo: {
        scenario,
        messageCount: 0
      }
    });
  } catch (err) {
    console.error('Error in startConversation:', err);
    res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Send a message in a conversation using Groq
// @route   POST /api/conversations/:id/message
// @access  Private
exports.sendMessage = async (req, res) => {
  try {
    const { content, difficulty, additionalInfo } = req.body;
    
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return res.status(400).json({ message: 'Message content is required' });
    }
    
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    if (conversation.isCompleted) {
      return res.status(400).json({ message: 'Conversation has already ended' });
    }
    
    // Add agent message
    const agentMessage = {
      sender: 'agent',
      content: content.trim(),
      timestamp: new Date()
    };
    
    conversation.messages.push(agentMessage);
    
    // Prepare messages for Groq
    const systemPrompt = createSystemPrompt(conversation.scenario, difficulty, additionalInfo);
    const messagesForLLM = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Add conversation history (keep a longer rolling window but exclude the just-added agent message)
    const HISTORY_WINDOW = 12;
    const startIndex = Math.max(conversation.messages.length - (HISTORY_WINDOW + 1), 0);
    const recentMessages = conversation.messages.slice(startIndex, conversation.messages.length - 1);

    // Build a lightweight transcript for the system prompt so the LLM knows what was already discussed
    const conversationContextText = recentMessages.length
      ? recentMessages
          .map(msg => `${msg.sender === 'agent' ? 'Loan Agent' : 'Customer'}: ${msg.content}`)
          .join('\n')
      : 'Conversation just started. The customer has not provided details yet.';

    const antiRepeatInstructions = `
Conversation context so far (oldest to newest):
${conversationContextText}

Memory & freshness rules:
- Do not repeat a question or request that was already asked earlier in this chat.
- If the loan agent already answered a question, acknowledge the answer and drive the conversation forward with a new, related follow-up.
- Reference the agent's most recent reply before asking something new so the dialogue feels natural.
- Vary wording and keep the conversation progressing toward a decision.`.trim();

    messagesForLLM[0] = {
      role: 'system',
      content: `${messagesForLLM[0].content}\n\n${antiRepeatInstructions}`
    };
    for (const msg of recentMessages) {
      if (msg.sender === 'agent') {
        messagesForLLM.push({ role: 'user', content: msg.content });
      } else if (msg.sender === 'ai') {
        messagesForLLM.push({ role: 'assistant', content: msg.content });
      }
    }
    
    // Add the current agent message with explicit instructions
    messagesForLLM.push({ 
      role: 'user', 
      content: `Agent: ${content.trim()}

[INSTRUCTION: You are the CUSTOMER. The above message is from the loan agent. Respond as a customer would - with questions, concerns, requests for clarification, or reactions. Do NOT act as an agent.]` 
    });
    
    console.log('Sending to Groq:', {
      endpoint: config.GROQ_ENDPOINT,
      model: config.GROQ_MODEL,
      messageCount: messagesForLLM.length
    });
    
    // Call Groq API
    let customerResponse;
    try {
      const response = await localLLM.chat.completions.create({
        model: config.GROQ_MODEL,
        messages: messagesForLLM,
        temperature: config.TEMPERATURE,
        max_tokens: config.MAX_TOKENS,
        stream: false
      });

      // Clean LLM response of <think>...</think>
      customerResponse = response.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      console.log('Groq response received successfully');
      
    } catch (llmError) {
      console.error('Groq API Error:', llmError.message);
      
      // Fallback to predefined responses if Groq is unavailable
      if (llmError.code === 'ECONNREFUSED') {
        customerResponse = "I'm sorry, I'm having some technical difficulties right now. Could you please repeat that or try again in a moment?";
      } else {
        customerResponse = "I'm not sure I understand. Could you please explain that in a different way?";
      }
    }
    
    // Add customer (AI) response
    const customerMessage = {
      sender: 'ai',
      content: customerResponse,
      timestamp: new Date()
    };
    
    conversation.messages.push(customerMessage);
    
    // Save the updated conversation
    await conversation.save();

    // Clean <think>...</think> from both agent and customer messages before sending to client
    const cleanedMessages = [agentMessage, customerMessage].map(msg => ({
      ...msg,
      content: msg.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    }));

    // Return both messages
    res.json({
      messages: cleanedMessages,
      sessionInfo: {
        messageCount: conversation.messages.length - 1, // Exclude initial message
        scenario: conversation.scenario
      }
    });
  } catch (err) {
    console.error('Error in sendMessage:', err);
    res.status(500).json({ 
      message: 'Failed to process message', 
      error: process.env.NODE_ENV === 'development' ? err.message : undefined 
    });
  }
};

// @desc    Get conversation analysis using Groq
// @route   POST /api/conversations/:id/analyze
// @access  Private
exports.analyzeConversation = async (req, res) => {
  console.log('Analyzing conversation:', req.params.id, 'with body:', req.body);
  try {
    const conversation = await Conversation.findById(req.params.id);
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    if (conversation.messages.length < 3) {
      return res.status(400).json({ message: 'Not enough conversation data for analysis' });
    }
    
    // Replace messages in the conversation with the latest messages from the request if provided
    if (req.body && Array.isArray(req.body.messages) && req.body.messages.length > 0) {
      conversation.messages = req.body.messages;
    }

    // Format conversation for analysis
    const conversationText = conversation.messages
      .filter(msg => msg.sender !== 'system')
      .map(msg => `${msg.sender === 'agent' ? 'Loan Agent' : 'Customer'}: ${msg.content}`)
      .join('\n\n');

    const analysisPrompt = `You are an expert sales coach specializing in banking and financial services. Analyze the following loan agent training conversation and provide your feedback strictly in the JSON format below.

Use the following scoring guide for the final overall rating:

90–100 = Excellent

75–89 = Good

60–74 = Average

40–59 = Below Average

0–39 = Poor

🔹 Scoring Formula:
overallScore = (salesEffectiveness.score + technicalProficiency.score + complianceEthics.score) / 3

🔹 Marking Scheme:
1. Sales Effectiveness
Weight: 100 points, equally divided across four criteria:

Needs Analysis (25%)

Identifies customer's goals, concerns, and loan purpose

Asks open-ended, diagnostic questions

Product Match (25%)

Recommends a suitable loan product based on needs

Explains key features/benefits relevant to customer

Objection Handling (25%)

Acknowledges and addresses concerns confidently

Avoids defensive or dismissive responses

Deal Progress (25%)

Attempts to move the customer closer to a decision

Clearly explains next steps in the process

⚠️ If any of these four elements are not addressed, assign only 5–10% of that sub-score.

2. Technical Proficiency
Weight: 100 points, distributed as follows:

Terminology Accuracy (40%)

Uses correct financial/banking terms (e.g., EMI, interest rate, CIBIL)

Avoids inaccurate or misleading statements

Process Accuracy (30%)

Correctly explains documentation, approval, and disbursal process

Mentions timelines, eligibility criteria, etc.

System Navigation (30%) (if applicable)

Shows knowledge of CRM/software tools

Refers to how to access customer status/info accurately

⚠️ If any elements are missing or vague, award partial credit (5–10%).

3. Compliance & Ethics
Weight: 100 points, distributed as follows:

T&C Disclosure (40%)

Clearly explains repayment terms, interest rate, fees, penalties

Honesty/Fair Selling (30%)

Does not exaggerate benefits or hide limitations

Maintains a transparent, trust-building tone

Data Sensitivity (30%)

Avoids asking for sensitive info without need/context

Demonstrates understanding of privacy principles

⚠️ Missing disclosures or ethical oversights should be penalized accordingly.

🔹 Output Format:
Return only a valid JSON object in the exact format below:

{
  "overallScore": [0-100, integer],
  "comments": "Short summary of performance",
  "suggestions": ["One-liner suggestion", "..."],
  "areasForImprovement": ["Shortcoming 1", "..."],
  "performanceMetrics": {
    "salesEffectiveness": {
      "score": [0-100, integer],
      "strengths": ["..."]
    },
    "technicalProficiency": {
      "score": [0-100, integer],
      "strengths": ["..."]
    },
    "complianceEthics": {
      "score": [0-100, integer],
      "strengths": ["..."]
    },
    "detailedSuggestions": {
      "conversationFlow": ["Specific suggestion for improving conversation flow", "..."],
      "productKnowledge": ["Specific suggestion for improving product knowledge", "..."],
      "communicationStyle": ["Specific suggestion for improving communication style", "..."]
    }
  }
}
🔹 Input:
CONVERSATION:
${conversationText}

CONTEXT:

Scenario: ${conversation.scenario}

Instructions:

Carefully review the conversation and context.

Score each metric and sub-metric using the marking scheme.

Penalize missing or unclear responses with 5–10% where appropriate.

Calculate overallScore as the average of the 3 category scores.

Return only the valid JSON object. No extra explanation or commentary.`;

    try {
      const response = await localLLM.chat.completions.create({
        model: config.GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are an expert sales coach providing detailed feedback on loan agent training conversations.' },
          { role: 'user', content: analysisPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      // Log the raw analytics response from Groq
      console.log('Groq analytics response:', response.choices[0].message.content);

      // Clean <think>...</think> from analysis response
      let analysis = response.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

      // Remove code block markers (e.g., ```json ... ```)
      analysis = analysis.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

      // Parse analysis and extract scores
      let analysisObj;
      try {
        analysisObj = JSON.parse(analysis);
      } catch (e) {
        console.error('Error parsing analysis JSON:', e);
        analysisObj = null;
      }

      if (analysisObj && typeof analysisObj === 'object') {
        // Extract the four scores in the required order
        const overallScore = analysisObj.overallScore || 0;
        const salesScore = analysisObj.performanceMetrics?.salesEffectiveness?.score || 0;
        const techScore = analysisObj.performanceMetrics?.technicalProficiency?.score || 0;
        const complianceScore = analysisObj.performanceMetrics?.complianceEthics?.score || 0;

        // Initialize feedback object if it doesn't exist
        if (!conversation.feedback) {
          conversation.feedback = {};
        }

        // Update the feedback object with scores and analysis
        conversation.feedback = {
          ...conversation.feedback,
          score: [overallScore, salesScore, techScore, complianceScore],
          comments: analysisObj.comments || '',
          suggestions: analysisObj.suggestions || [],
          areasForImprovement: analysisObj.areasForImprovement || [],
          detailedSuggestions: analysisObj.performanceMetrics?.detailedSuggestions || {
            conversationFlow: [],
            productKnowledge: [],
            communicationStyle: []
          }
        };
      }

      // Save updated conversation
      await conversation.save();
      
      res.json({ 
        analysis,
        feedback: conversation.feedback, // Return the updated feedback object
        sessionStats: {
          duration: conversation.completedAt ? 
            new Date(conversation.completedAt) - new Date(conversation.createdAt) : 
            new Date() - new Date(conversation.createdAt),
          messageCount: conversation.messages.length - 1,
          scenario: conversation.scenario
        }
      });

    } catch (llmError) {
      console.error('Groq Analysis Error:', llmError.message);
      
      // Fallback analysis
      const fallbackAnalysis = `Analysis temporarily unavailable due to technical issues.
      
*Conversation Summary:*
- Scenario: ${conversation.scenario}
- Messages exchanged: ${conversation.messages.length - 1}
- Duration: ${Math.round((new Date() - new Date(conversation.createdAt)) / 60000)} minutes

*General Feedback:*
Based on the conversation length and scenario, you've engaged in a meaningful practice session. Continue practicing to improve your loan agent skills.

Please try the analysis feature again when the AI service is available.`;

      res.json({ 
        analysis: fallbackAnalysis,
        sessionStats: {
          duration: new Date() - new Date(conversation.createdAt),
          messageCount: conversation.messages.length - 1,
          scenario: conversation.scenario
        }
      });
    }
  } catch (err) {
    console.error('Error in analyzeConversation:', err);
    res.status(500).json({ 
      message: 'Failed to analyze conversation', 
      error: process.env.NODE_ENV === 'development' ? err.message : undefined 
    });
  }
};

// @desc    End a conversation and get feedback
// @route   POST /api/conversations/:id/end
// @access  Private
exports.endConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Mark conversation as completed
    conversation.isCompleted = true;
    conversation.isTemporary = false;
    conversation.completedAt = new Date();
    
    await conversation.save();
    
    // Clean up other temporary conversations for this user
    if (conversation.userId !== 'anonymous') {
      await Conversation.deleteMany({ 
        userId: conversation.userId,
        isTemporary: true,
        _id: { $ne: conversation._id }
      });
    }

    res.json({
      message: 'Conversation ended successfully',
      conversationId: conversation._id,
      canAnalyze: conversation.messages.length > 2
    });
  } catch (err) {
    console.error('Error in endConversation:', err);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Get conversation history
// @route   GET /api/conversations/history
// @access  Private
exports.getConversationHistory = async (req, res) => {
  try {
    console.log('Getting conversation history for user:', req.user?.id);
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const total = await Conversation.countDocuments({ 
      userId: req.user.id,
      isTemporary: false,
      isCompleted: true
    });

    const conversations = await Conversation.find({ 
      userId: req.user.id,
      isTemporary: false,
      isCompleted: true
    })
      .sort('-createdAt')
      .select('scenario isCompleted createdAt completedAt feedback.score') // Ensure feedback.score is selected
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      conversations,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        hasMore: skip + conversations.length < total
      }
    });
  } catch (err) {
    console.error('Error in getConversationHistory:', err);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Get the highest overall score from a user's past conversations
// @route   GET /api/conversations/highest-score
// @access  Private (uses req.user.id)
exports.getHighestOverallScore = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const conversations = await Conversation.find({
      userId: req.user.id,
      isCompleted: true,
      isTemporary: false,
      'feedback.score': { $exists: true, $ne: [] } // Ensure feedback.score exists and is not empty
    })
    .select('feedback.score') // Only select the feedback score
    .lean();

    if (!conversations || conversations.length === 0) {
      return res.json({ highestScore: null, message: 'No completed conversations with scores found.' });
    }

    let highestScore = null; // Initialize with null, to distinguish from a highest score of 0

    conversations.forEach(convo => {
      if (convo.feedback && convo.feedback.score && convo.feedback.score.length > 0) {
        const overallScore = convo.feedback.score[0]; // Assuming score[0] is the overall score
        if (typeof overallScore === 'number') { // Ensure it's a number
          if (highestScore === null || overallScore > highestScore) {
            highestScore = overallScore;
          }
        }
      }
    });
    
    // highestScore will be null if no valid scores were found, or the actual highest score (could be 0).
    return res.json({ highestScore: highestScore });

  } catch (err) {
    console.error('Error in getHighestOverallScore:', err);
    res.status(500).json({ 
      message: 'Server error while fetching highest score',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined 
    });
  }
};

// @desc    Get the last conversation's score for a user
// @route   GET /api/conversations/last-score
// @access  Private (uses req.user.id)
exports.getLastConversationScore = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const lastConversation = await Conversation.findOne({
      userId: req.user.id,
      isCompleted: true,
      isTemporary: false,
      'feedback.score': { $exists: true, $ne: [] }
    })
    .sort('-completedAt') // Sort by completedAt in descending order to get the most recent
    .select('feedback.score completedAt')
    .lean();

    if (!lastConversation) {
      return res.json({ 
        lastScore: null, 
        message: 'No completed conversations with scores found.' 
      });
    }

    // Ensure we're getting the exact score from feedback.score[0]
    const lastScore = lastConversation.feedback.score[0];
    
    // Validate that the score is a number
    if (typeof lastScore !== 'number') {
      console.error('Invalid score format in last conversation:', lastConversation._id);
      return res.status(500).json({ 
        message: 'Invalid score format in last conversation',
        error: process.env.NODE_ENV === 'development' ? 'Score is not a number' : undefined
      });
    }
    
    return res.json({ 
      lastScore,
      completedAt: lastConversation.completedAt
    });

  } catch (err) {
    console.error('Error in getLastConversationScore:', err);
    res.status(500).json({ 
      message: 'Server error while fetching last conversation score',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined 
    });
  }
};