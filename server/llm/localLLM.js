// Lightweight local LLM simulator to replace external Groq API calls.
// This is a simple, deterministic heuristic-based generator intended for
// offline development, demos, and tests. It mimics the Groq chat completions
// interface used in the codebase: `chat.completions.create({ model, messages, ... })`.

// NOTE: This is not a production-grade LLM. Replace with a real model/runtime
// if you need higher-quality, contextual responses.

const SCENARIO_QUESTION_BANKS = {
  general: [
    'Could you tell me the basic eligibility I should meet?',
    'What documents will you need from me first?',
    'How long does the overall approval usually take?',
    'Are there any fees or charges I should keep in mind?',
    'What is the simplest first step for me to get started?'
  ],
  'credit-card': [
    'What is the minimum income needed for this card?',
    'Could you outline the joining fee and annual fee?',
    'Which documents do you check for a credit card application?',
    'Do I get any interest-free period and how is interest calculated later?',
    'How quickly could I receive the card once approved?'
  ],
  'personal-loan': [
    'What loan amount do you think I could realistically qualify for?',
    'Could you walk me through the EMI for a 3-year plan?',
    'What documents do you verify for a personal loan?',
    'How fast is the approval and disbursal usually?',
    'Are there any prepayment or processing charges I should note?'
  ],
  'business-loan': [
    'What financial statements do you normally review for a business loan?',
    'Could you explain the working capital options I might consider?',
    'How is the interest rate decided for small business owners?',
    'What collateral, if any, would you look for in my case?',
    'How long is the typical approval timeline?'
  ],
  savings: [
    'What is the current interest rate on this savings option?',
    'Is there a minimum balance that I must maintain?',
    'Could you explain the withdrawal or liquidity rules?',
    'Do I get any linked benefits such as debit cards or offers?',
    'How soon can I start once I share my KYC documents?'
  ],
  demat: [
    'What is the simplest way to open the demat account?',
    'Could you list the account opening and annual maintenance charges?',
    'What documents and identity proofs will you need from me?',
    'How do I link this account with trading or banking services?',
    'Roughly how long does activation take after submission?'
  ],
  investment: [
    'What risk level does this investment option carry?',
    'Could you explain the expected returns in simple terms?',
    'Is there a lock-in period or any exit charge?',
    'What documents or KYC steps must I complete?',
    'How frequently can I review or change my investment plan?'
  ]
};

const localLLM = {
  chat: {
    completions: {
      create: async (opts = {}) => {
        const messages = Array.isArray(opts.messages) ? opts.messages : [];

        const combined = messages.map(m => (m && m.content) ? m.content : '').join('\n');

        // Detect if this is the analysis prompt (the code sends a large analysis prompt)
        if (combined.includes('You are an expert sales coach') || combined.includes('Scoring Formula')) {
          // Try to extract the conversation block
          const convMatch = combined.match(/CONVERSATION:\s*([\s\S]*?)\s*CONTEXT:/i);
          const convoText = convMatch ? convMatch[1] : combined;

          const agentMsgs = [];
          const customerMsgs = [];

          convoText.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (/^Loan Agent:/i.test(trimmed)) agentMsgs.push(trimmed.replace(/^Loan Agent:\s*/i, '').trim());
            if (/^Customer:/i.test(trimmed)) customerMsgs.push(trimmed.replace(/^Customer:\s*/i, '').trim());
          });

          // Heuristic scoring
          const openEndedCount = agentMsgs.filter(m => /\?|\bhow\b|\bwhat\b|\bwhy\b|could you|tell me|please explain/i.test(m)).length;
          const needsAnalysis = openEndedCount >= 1 ? 80 : 40;
          const productMatch = agentMsgs.some(m => /recommend|suit|eligib|interest|rate|tenure|EMI|recommendation/i.test(m)) ? 80 : 50;
          const objectionHandling = agentMsgs.some(m => /sorry|understand|concern|worry|issue|instead|but|however/i.test(m)) ? 70 : 40;
          const dealProgress = agentMsgs.some(m => /next step|apply|submit|documents|process|approval|follow up/i.test(m)) ? 75 : 40;
          const salesScore = Math.round((needsAnalysis + productMatch + objectionHandling + dealProgress) / 4);

          const technicalTerms = agentMsgs.join(' ').match(/EMI|interest|CIBIL|documents|disbursal|eligibility|fees|penal|rate/gi) || [];
          const techScore = Math.min(100, 50 + technicalTerms.length * 10);

          const complianceScore = /terms|T&C|disclosure|fee|penalty|privacy|consent/i.test(agentMsgs.join(' ')) ? 75 : 55;

          const overall = Math.round((salesScore + techScore + complianceScore) / 3);

          const analysisObj = {
            overallScore: overall,
            comments: 'Automated heuristic feedback generated by local LLM simulator.',
            suggestions: [
              'Ask more open-ended diagnostic questions early in the call.',
              'Give clearer product recommendations tied to customer needs.',
              'State explicit next steps and documentation requirements.'
            ],
            areasForImprovement: [
              'Needs stronger needs-analysis phase',
              'Add concise product benefits and rates',
              'Include compliance disclosures when discussing costs'
            ],
            performanceMetrics: {
              salesEffectiveness: {
                score: salesScore,
                strengths: openEndedCount ? ['Some open-ended questions and diagnostic prompts'] : ['Some product guidance present']
              },
              technicalProficiency: {
                score: techScore,
                strengths: technicalTerms.length ? ['Used relevant product/technical terminology'] : ['Basic product descriptions present']
              },
              complianceEthics: {
                score: complianceScore,
                strengths: /terms|T&C|disclosure|fee|penalty|privacy|consent/i.test(agentMsgs.join(' ')) ? ['Mentions T&C or fees'] : ['Neutral and non-misleading tone']
              },
              detailedSuggestions: {
                conversationFlow: [
                  'Start with a clear needs-analysis question and summarize the customer goals',
                  'Use an explicit close or next step after giving product options'
                ],
                productKnowledge: [
                  'Reference eligibility criteria and sample EMIs to make recommendations tangible',
                  'Mention documentation and timelines when proposing an application'
                ],
                communicationStyle: [
                  'Use empathic acknowledgements and shorter, clearer sentences',
                  'Confirm understanding by asking a recap question'
                ]
              }
            }
          };

          return { choices: [{ message: { content: JSON.stringify(analysisObj) } }] };
        }

        // Otherwise produce a short customer-style reply that follows up on the last agent message
        // Find recent agent (user) and assistant messages
        const reversed = [...messages].reverse();
        const lastAgentMsg = reversed.find(m => m.role === 'user');
        const agentContent = lastAgentMsg ? lastAgentMsg.content : '';

        const assistantHistory = messages
          .filter(m => m.role === 'assistant' && typeof m.content === 'string')
          .slice(-6)
          .map(m => (m.content || '').trim())
          .filter(Boolean);

        const normalize = (text = '') =>
          text
            .toLowerCase()
            .replace(/[^a-z0-9\s?]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const focusKeywords = ['emi', 'document', 'apply', 'timeline', 'budget', 'fee', 'compare', 'example', 'next step', 'clarify', 'income'];
        const getTags = (text = '') => focusKeywords.filter(tag => text.includes(tag));

        const assistantMemory = assistantHistory.map(original => ({
          original,
          normalized: normalize(original),
          tags: getTags(normalize(original))
        }));

        const lastAssistantMsg = assistantHistory.length ? assistantHistory[assistantHistory.length - 1] : '';
        let lastScenarioKey = 'general';

        const isRepeat = (candidate = '') => {
          const normalizedCandidate = normalize(candidate);
          if (!normalizedCandidate) return false;
          const tags = getTags(normalizedCandidate);
          return assistantMemory.some(memory => {
            if (!memory.normalized) return false;
            if (memory.normalized === normalizedCandidate) return true;
            if (!tags.length || !memory.tags.length) return false;
            return tags.some(tag => memory.tags.includes(tag));
          });
        };

        const pickScenarioQuestion = (scenarioKey = 'general') => {
          const options = SCENARIO_QUESTION_BANKS[scenarioKey] || SCENARIO_QUESTION_BANKS.general;
          const fresh = options.find(q => !isRepeat(q));
          if (fresh) return fresh;
          const generalFallback = SCENARIO_QUESTION_BANKS.general.find(q => !isRepeat(q));
          return generalFallback || 'Could you share a bit more detail so I can respond properly?';
        };

        // Helper to extract simple numbers/amounts from text
        const extractNumber = (text) => {
          if (!text) return null;
          const m = text.match(/₹?\s*([0-9,]+(?:\.[0-9]+)?)/);
          if (m) return m[1].replace(/,/g, '');
          const plain = text.match(/(\d{4,}|\d+(?:\.\d+)?)/);
          return plain ? plain[0] : null;
        };

        // Build a contextual follow-up
        const makeFollowUp = (agentText, assistantText) => {
          const a = (agentText || '').toLowerCase();
          const s = (assistantText || '').toLowerCase();
          const combinedContext = (a + ' ' + s + ' ' + combined).toLowerCase();

          // Scenario detection from context (simple keyword matching)
          const isCreditCard = /credit\s?-?card|creditcard|card/i.test(combinedContext);
          const isPersonalLoan = /personal-?loan|personal loan|daughter|wedding|marriage|money for/i.test(combinedContext);
          const isBusinessLoan = /business-?loan|business loan|grocery|shop|store|expand|expand it/i.test(combinedContext);
          const isSavings = /savings|account|deposit/i.test(combinedContext);
          const isDemat = /demat|dematerialized|stock|equity/i.test(combinedContext);
          const isInvestment = /investment|mutual fund|sip|portfolio/i.test(combinedContext);

          lastScenarioKey = (() => {
            if (isCreditCard) return 'credit-card';
            if (isPersonalLoan) return 'personal-loan';
            if (isBusinessLoan) return 'business-loan';
            if (isSavings) return 'savings';
            if (isDemat) return 'demat';
            if (isInvestment) return 'investment';
            return 'general';
          })();

          // If agent asked about rates/EMI, ask for loan amount/tenure or income to calculate EMI
          if (/rate|interest|emi|monthly payment|monthly instalment|emi amount/i.test(a)) {
            const num = extractNumber(s);
            if (num) {
              if (isPersonalLoan) {
                return `Could you share the EMI on ₹${num} for a 3-year and 5-year plan?`;
              }
              if (isBusinessLoan) {
                return `If I borrow ₹${num}, what would the EMI look like for 3 or 5 years?`;
              }
              return `Can you estimate the EMI on ₹${num} for short and long tenures?`;
            }
            if (isCreditCard) {
              return 'What is the interest on dues and the main card fees?';
            }
            return 'Could you tell me the EMI range and common tenure options?';
          }

          // If agent mentioned documents or application process
          if (/document|documents|apply|application|kyc|id proof|income proof/i.test(a)) {
            if (isCreditCard) {
              return 'Which basic documents do you need for the card, and is approval quick?';
            }
            if (isBusinessLoan) {
              return 'What business papers do you check and roughly how long is approval?';
            }
            return 'What simple document list should I prepare and how long is the process?';
          }

          // If agent recommended a product or asked preference
          if (/recommend|suit|best option|product|offer|plan/i.test(a)) {
            // If customer previously mentioned a constraint, reference it
            if (/saving|budget|income|salary|afford/i.test(s)) {
              const num = extractNumber(s);
              if (num) return `You recommended that product; with ₹${num} income will it stay affordable each month?`;
              return 'Will that option fit a limited monthly budget?';
            }
            if (isCreditCard) {
              return 'Is there a card with lower fees that is still good for me?';
            }
            return 'Can you compare it with one simpler or cheaper option?';
          }

          // If agent asked a short/unclear question, ask for clarification
          if (agentText && agentText.trim().length < 60 && agentText.trim().endsWith('?')) {
            return `Could you please clarify what you meant by "${agentText.trim()}"?`;
          }

          // Default: ask a relevant open-ended follow-up referencing the last assistant statement if present
          if (assistantText && assistantText.trim().length > 0) {
            const snippet = assistantText.length > 60 ? assistantText.slice(0, 57) + '...' : assistantText;
            return `Based on "${snippet}", could you clarify one key benefit for me?`;
          }

          // Fallback follow-up
          return pickScenarioQuestion(lastScenarioKey);
        };

        let reply = makeFollowUp(agentContent, lastAssistantMsg);
        if (isRepeat(reply)) {
          reply = pickScenarioQuestion(lastScenarioKey);
        }
        reply = reply.replace(/\s+/g, ' ').trim();
        if (reply.length > 140) {
          reply = `${reply.slice(0, 137).trim()}...`;
        }
        if (reply && !/[.?!]$/.test(reply)) {
          reply = `${reply}?`;
        }

        return { choices: [{ message: { content: reply } }] };
      }
    }
  }
};

module.exports = localLLM;
