const { v4: uuidv4 } = require('uuid');
const logger = require('./utils/logger');
const livekitClient = require('./livekitClient');
const deepgramHandler = require('./deepgramHandler');
const llmBot = require('./llmBot');

class CallManager {
  constructor() {
    this.activeCalls = new Map(); // Map of active calls by callId
    this.botParticipants = new Map(); // Map to track bot participant identities
  }

  /**
   * Handle an inbound call and set up the call flow
   * @param {string} roomName - LiveKit room name
   * @param {string} callerIdentity - Identity of the caller
   * @returns {Promise<Object>} - Call details
   */
  async handleInboundCall(roomName, callerIdentity) {
    try {
      // Generate a unique call ID
      const callId = uuidv4();
      logger.info(`Handling inbound call from ${callerIdentity} in room ${roomName}, call ID: ${callId}`);
      
      // Generate a unique bot identity for this call
      const botIdentity = `bot-${callId}`;
      
      // Create or get the LiveKit room
      await livekitClient.createOrGetRoom(roomName);
      
      // Generate a token for the bot participant
      const botToken = livekitClient.generateToken(roomName, botIdentity, true);
      
      // Initialize the LLM conversation
      llmBot.initializeConversation(callId, {
        type: 'inbound',
        caller: callerIdentity,
        roomName,
      });
      
      // Add a welcome system message to LLM
      llmBot.addSystemMessage(callId, 
        `This is an inbound call from ${callerIdentity}. Be welcoming and helpful.`);
      
      // Store call details
      this.activeCalls.set(callId, {
        id: callId,
        roomName,
        type: 'inbound',
        callerIdentity,
        botIdentity,
        botToken,
        startTime: new Date(),
        status: 'initializing',
      });
      
      // Track bot participant for this room
      this.botParticipants.set(roomName, botIdentity);
      
      logger.info(`Inbound call handling initialized, call ID: ${callId}`);
      
      return {
        callId,
        roomName,
        botIdentity,
        botToken,
      };
    } catch (error) {
      logger.error(`Error handling inbound call: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initiate an outbound call to a phone number
   * @param {string} phoneNumber - Target phone number
   * @param {Object} options - Call options
   * @returns {Promise<Object>} - Call details
   */
  async initiateOutboundCall(phoneNumber, options = {}) {
    try {
      // Generate a unique call ID and room name
      const callId = uuidv4();
      const roomName = options.roomName || `call-${callId}`;
      const botIdentity = `bot-${callId}`;
      
      logger.info(`Initiating outbound call to ${phoneNumber}, room: ${roomName}, call ID: ${callId}`);
      
      // Create the LiveKit room
      await livekitClient.createOrGetRoom(roomName);
      
      // Generate a token for the bot participant
      const botToken = livekitClient.generateToken(roomName, botIdentity, true);
      
      // Place the outbound call through LiveKit's SIP interface
      const callResult = await livekitClient.placeOutboundCall(roomName, phoneNumber);
      
      // Initialize the LLM conversation
      llmBot.initializeConversation(callId, {
        type: 'outbound',
        phoneNumber,
        roomName,
      });
      
      // Add a context system message to LLM
      if (options.initialContext) {
        llmBot.addSystemMessage(callId, options.initialContext);
      }
      
      // Store call details
      this.activeCalls.set(callId, {
        id: callId,
        roomName,
        type: 'outbound',
        phoneNumber,
        botIdentity,
        botToken,
        startTime: new Date(),
        status: 'calling',
        sipDetails: callResult,
      });
      
      // Track bot participant for this room
      this.botParticipants.set(roomName, botIdentity);
      
      logger.info(`Outbound call initiated, call ID: ${callId}`);
      
      return {
        callId,
        roomName,
        botIdentity,
        botToken,
        sipDetails: callResult,
      };
    } catch (error) {
      logger.error(`Error initiating outbound call: ${error.message}`);
      throw error;
    }
  }

  /**
   * Set up speech-to-text processing for a call
   * @param {string} callId - Call identifier
   * @param {Function} audioCallback - Function to receive audio from TTS
   * @returns {Object} - STT session details
   */
  setupSpeechToText(callId, audioCallback) {
    try {
      logger.info(`Setting up speech-to-text for call: ${callId}`);
      
      if (!this.activeCalls.has(callId)) {
        throw new Error(`Call ID not found: ${callId}`);
      }
      
      // Setup the transcription callback
      const handleTranscription = async (transcriptionResult) => {
        // Only process final transcripts for LLM
        if (transcriptionResult.isFinal && transcriptionResult.transcript) {
          const call = this.activeCalls.get(callId);
          call.lastTranscript = transcriptionResult.transcript;
          call.lastTranscriptTime = new Date();
          this.activeCalls.set(callId, call);
          
          // Process the transcript with LLM
          const botResponse = await llmBot.processMessage(callId, transcriptionResult.transcript);
          
          // Convert bot response to speech
          const audioBuffer = await deepgramHandler.textToSpeech(botResponse);
          
          // Send audio back to call using the callback
          if (audioCallback && typeof audioCallback === 'function') {
            audioCallback(audioBuffer);
          }
        }
      };
      
      // Start Deepgram STT session
      const sttSession = deepgramHandler.startSTTSession(callId, handleTranscription);
      
      // Update call with STT session info
      const call = this.activeCalls.get(callId);
      call.sttSession = sttSession;
      call.status = 'active';
      this.activeCalls.set(callId, call);
      
      return { sttSession };
    } catch (error) {
      logger.error(`Error setting up speech-to-text: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send audio data for transcription
   * @param {string} callId - Call identifier
   * @param {Buffer} audioData - Raw audio data
   * @returns {boolean} - Success status
   */
  processAudioForTranscription(callId, audioData) {
    try {
      if (!this.activeCalls.has(callId)) {
        logger.warn(`Call ID not found for audio processing: ${callId}`);
        return false;
      }
      
      return deepgramHandler.sendAudioForTranscription(callId, audioData);
    } catch (error) {
      logger.error(`Error processing audio: ${error.message}`);
      return false;
    }
  }

  /**
   * End an active call and clean up resources
   * @param {string} callId - Call to end
   * @returns {Promise<boolean>} - Success status
   */
  async endCall(callId) {
    try {
      logger.info(`Ending call: ${callId}`);
      
      if (!this.activeCalls.has(callId)) {
        logger.warn(`Call ID not found for ending: ${callId}`);
        return false;
      }
      
      const call = this.activeCalls.get(callId);
      
      // End STT session
      deepgramHandler.endSTTSession(callId);
      
      // End LLM conversation
      llmBot.endConversation(callId);
      
      // Remove bot from room if still active
      try {
        if (call.botIdentity) {
          await livekitClient.disconnectParticipant(call.roomName, call.botIdentity);
        }
        
        // Clean up bot participant tracking
        this.botParticipants.delete(call.roomName);
      } catch (disconnectError) {
        logger.warn(`Error disconnecting bot participant: ${disconnectError.message}`);
      }
      
      // Update call status
      call.status = 'ended';
      call.endTime = new Date();
      call.duration = (call.endTime - call.startTime) / 1000; // in seconds
      this.activeCalls.set(callId, call);
      
      logger.info(`Call ended successfully: ${callId}, duration: ${call.duration}s`);
      
      // Optional: Remove call from active calls after a delay
      setTimeout(() => {
        this.activeCalls.delete(callId);
        logger.info(`Call data removed from memory: ${callId}`);
      }, 60000); // Keep call data for 1 minute after ending
      
      return true;
    } catch (error) {
      logger.error(`Error ending call: ${error.message}`);
      return false;
    }
  }

  /**
   * Get details about an active call
   * @param {string} callId - Call ID to query
   * @returns {Object|null} - Call details or null if not found
   */
  getCallDetails(callId) {
    if (this.activeCalls.has(callId)) {
      const call = this.activeCalls.get(callId);
      return {
        id: call.id,
        type: call.type,
        status: call.status,
        roomName: call.roomName,
        startTime: call.startTime,
        duration: call.endTime ? (call.endTime - call.startTime) / 1000 : (new Date() - call.startTime) / 1000,
        callerIdentity: call.callerIdentity,
        phoneNumber: call.phoneNumber,
        lastTranscript: call.lastTranscript,
        lastTranscriptTime: call.lastTranscriptTime,
      };
    }
    return null;
  }

  /**
   * Get a list of all active calls
   * @returns {Array<Object>} - List of active call details
   */
  getAllActiveCalls() {
    const calls = [];
    for (const [callId, call] of this.activeCalls.entries()) {
      if (call.status !== 'ended') {
        calls.push(this.getCallDetails(callId));
      }
    }
    return calls;
  }
}

module.exports = new CallManager();
