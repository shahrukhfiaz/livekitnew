const { OpenAI } = require('openai');
const logger = require('./utils/logger');

class LLMBot {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.conversations = new Map(); // Store conversation history by callId
    this.systemPrompt = process.env.LLM_SYSTEM_PROMPT || 
      "You are an AI assistant on a phone call. Be helpful, concise, and conversational. Ask questions when needed.";
  }

  /**
   * Initialize a new conversation session
   * @param {string} callId - Unique call identifier
   * @param {Object} metadata - Optional metadata about the call
   * @returns {string} - Session ID
   */
  initializeConversation(callId, metadata = {}) {
    logger.info(`Initializing LLM conversation for call: ${callId}`);
    
    // Create conversation history with system prompt
    this.conversations.set(callId, {
      messages: [
        { role: 'system', content: this.systemPrompt },
      ],
      metadata
    });
    
    return callId;
  }

  /**
   * Process user input and generate a response
   * @param {string} callId - Call identifier
   * @param {string} userInput - Transcribed user speech
   * @returns {Promise<string>} - Bot response
   */
  async processMessage(callId, userInput) {
    try {
      // Get or initialize conversation history
      if (!this.conversations.has(callId)) {
        this.initializeConversation(callId);
      }
      
      const conversation = this.conversations.get(callId);
      
      // Add user message to history
      conversation.messages.push({ role: 'user', content: userInput });
      
      logger.info(`Processing user input for call ${callId}: "${userInput.substring(0, 50)}${userInput.length > 50 ? '...' : ''}"`);
      
      // Send conversation to OpenAI
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: conversation.messages,
        temperature: 0.7,
        max_tokens: 256
      });
      
      // Extract the response
      const botResponse = response.choices[0].message.content.trim();
      
      // Add assistant response to history
      conversation.messages.push({ role: 'assistant', content: botResponse });
      
      // Update conversation in the map
      this.conversations.set(callId, conversation);
      
      logger.info(`Bot response for call ${callId}: "${botResponse.substring(0, 50)}${botResponse.length > 50 ? '...' : ''}"`);
      
      return botResponse;
    } catch (error) {
      logger.error(`Error processing message: ${error.message}`);
      return "I'm sorry, I'm having trouble processing your request. Could you try again?";
    }
  }

  /**
   * Add a system message to the conversation
   * @param {string} callId - Call identifier
   * @param {string} content - System message content
   */
  addSystemMessage(callId, content) {
    if (!this.conversations.has(callId)) {
      this.initializeConversation(callId);
    }
    
    const conversation = this.conversations.get(callId);
    conversation.messages.push({ role: 'system', content });
    this.conversations.set(callId, conversation);
    
    logger.info(`Added system message to call ${callId}: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
  }

  /**
   * End a conversation session and clean up resources
   * @param {string} callId - Call identifier to end
   */
  endConversation(callId) {
    if (this.conversations.has(callId)) {
      logger.info(`Ending conversation for call: ${callId}`);
      this.conversations.delete(callId);
    }
  }
}

module.exports = new LLMBot();
