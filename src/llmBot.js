const logger = require('./utils/logger');
const { OpenAI } = require('openai');

// LiveKit RTC Diagnostic Block
const lkrtc = require('@livekit/rtc-node'); // Polyfill for WebRTC in Node.js via LiveKit
logger.info(`[LK_RTC_DIAGNOSTIC] Loaded @livekit/rtc-node module. Type: ${typeof lkrtc}`);
if (lkrtc && typeof lkrtc === 'object') {
  logger.info(`[LK_RTC_DIAGNOSTIC] @livekit/rtc-node exports: ${Object.keys(lkrtc).join(', ')}`);
  if (lkrtc.RTCPeerConnection) {
    logger.info('[LK_RTC_DIAGNOSTIC] RTCPeerConnection IS available as a direct export from @livekit/rtc-node.');
  } else {
    logger.warn('[LK_RTC_DIAGNOSTIC] RTCPeerConnection is NOT available as a direct export from @livekit/rtc-node.');
  }
}

try {
  if (globalThis.RTCPeerConnection) {
    const pc = new globalThis.RTCPeerConnection({ iceServers: [] });
    logger.info('[LK_RTC_DIAGNOSTIC] Successfully created RTCPeerConnection instance from globalThis via @livekit/rtc-node.');
    pc.close(); // Clean up the test peer connection
  } else {
    logger.error('[LK_RTC_DIAGNOSTIC] globalThis.RTCPeerConnection is still not defined after requiring @livekit/rtc-node.');
  }
} catch (e) {
  logger.error('[LK_RTC_DIAGNOSTIC] Failed to create RTCPeerConnection instance from globalThis via @livekit/rtc-node:', e);
}
// End LiveKit RTC Diagnostic Block
// Assuming livekit-client can be used in Node.js environment for the bot's client-side room interactions
// You might need to install it: npm install livekit-client
// Or use parts of livekit-server-sdk if appropriate for a non-media-participating orchestrator bot.
// For a bot that sends/receives audio, livekit-client is typical.
const { Room, RoomEvent, RemoteParticipant, RemoteTrack, RemoteTrackPublication } = require('livekit-client'); 

class LLMBot {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.conversations = new Map(); // Store conversation history by callId
    this.activeRooms = new Map(); // Store active LiveKit room connections by callId
    this.systemPrompt = process.env.LLM_SYSTEM_PROMPT || 
      "You are an AI assistant on a phone call. Be helpful, concise, and conversational. Ask questions when needed.";
    
    // LiveKit URL should be in your .env
    this.livekitUrl = process.env.LIVEKIT_URL;
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
  async joinRoom(callId, roomName, botIdentity, token) {
    if (!this.livekitUrl) {
      logger.error(`[${callId}] LiveKit URL not configured. Cannot join room.`);
      throw new Error('LiveKit URL not configured.');
    }
    if (this.activeRooms.has(callId)) {
      logger.warn(`[${callId}] Bot is already in room ${roomName}.`);
      return this.activeRooms.get(callId);
    }

    logger.info(`[${callId}] Bot ${botIdentity} attempting to join room: ${roomName}`);
    const room = new Room();
    this.activeRooms.set(callId, room);

    try {
      // Setup room event listeners
      room
        .on(RoomEvent.Connected, () => {
          logger.info(`[${callId}] Bot successfully connected to room: ${roomName}`);
          // TODO: Publish bot's audio track for TTS output
          // TODO: Setup subscriptions to other participants' audio tracks
        })
        .on(RoomEvent.Disconnected, () => {
          logger.info(`[${callId}] Bot disconnected from room: ${roomName}`);
          this.activeRooms.delete(callId);
        })
        .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          logger.info(`[${callId}] Track subscribed: ${track.sid} from ${participant.identity}`);
          // if (track.kind === 'audio' && participant.identity !== botIdentity) {
          //   // This is audio from the other participant (e.g., the PSTN caller)
          //   // TODO: Forward this audio to Deepgram
          //   track.on('message', (message) => { /* process audio data */ });
          // }
        });

      await room.connect(this.livekitUrl, token);
      logger.info(`[${callId}] Bot ${botIdentity} connection process initiated for room ${roomName}.`);
      return room;
    } catch (error) {
      logger.error(`[${callId}] Error connecting bot to room ${roomName}: ${error.message}`, error.stack);
      this.activeRooms.delete(callId);
      throw error;
    }
  }

  /**
   * Leave a LiveKit room.
   * @param {string} callId - The call ID associated with the room session.
   */
  async leaveRoom(callId) {
    if (this.activeRooms.has(callId)) {
      const room = this.activeRooms.get(callId);
      logger.info(`[${callId}] Bot disconnecting from room: ${room.name}`);
      await room.disconnect();
      this.activeRooms.delete(callId); // Ensure cleanup even if disconnect event is missed
    } else {
      logger.warn(`[${callId}] Bot not in any room to leave.`);
    }
  }

  /**
   * End a conversation session and clean up resources
   * @param {string} callId - Call identifier to end
   */
  async endConversation(callId) { // Made async to allow await for leaveRoom
    if (this.conversations.has(callId)) {
      logger.info(`Ending conversation for call: ${callId}`);
      this.conversations.delete(callId);
    }
    await this.leaveRoom(callId); // Ensure bot leaves the room
  }
}

module.exports = new LLMBot();
