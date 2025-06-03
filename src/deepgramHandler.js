const { Deepgram } = require('@deepgram/sdk');
const WebSocket = require('ws');
const logger = require('./utils/logger');

class DeepgramHandler {
  constructor() {
    this.apiKey = process.env.DEEPGRAM_API_KEY;
    this.deepgram = new Deepgram(this.apiKey);
    this.sttConnections = new Map(); // Map to store active STT WebSocket connections
  }

  /**
   * Start a real-time STT (Speech-to-Text) session
   * @param {string} callId - Unique identifier for the call
   * @param {Function} transcriptionCallback - Callback to receive transcription results
   * @returns {Object} - WebSocket connection details
   */
  startSTTSession(callId, transcriptionCallback) {
    try {
      logger.info(`Starting Deepgram STT session for call: ${callId}`);
      
      // Create Deepgram WebSocket connection
      const deepgramLive = this.deepgram.transcription.live({
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
        interim_results: true,
        model: 'nova-2',
        language: 'en-US',
        smart_format: true,
        vad_events: true // Voice activity detection
      });

      // Store the connection
      this.sttConnections.set(callId, deepgramLive);

      // Set up event handlers
      deepgramLive.addListener('open', () => {
        logger.info(`Deepgram STT connection established for call: ${callId}`);
      });

      deepgramLive.addListener('error', (error) => {
        logger.error(`Deepgram STT error for call ${callId}: ${error.message}`);
      });

      deepgramLive.addListener('close', () => {
        logger.info(`Deepgram STT connection closed for call: ${callId}`);
        this.sttConnections.delete(callId);
      });

      deepgramLive.addListener('transcriptReceived', (transcription) => {
        try {
          const dgData = JSON.parse(transcription);
          
          // Only process if we have a transcript with speech
          if (dgData.channel && 
              dgData.channel.alternatives && 
              dgData.channel.alternatives[0] && 
              dgData.channel.alternatives[0].transcript) {
            
            const transcript = dgData.channel.alternatives[0].transcript.trim();
            const isFinal = dgData.is_final;
            
            // Only process non-empty transcripts
            if (transcript && transcript.length > 0) {
              // Call the callback with the transcription result
              transcriptionCallback({
                callId,
                transcript,
                isFinal,
                confidence: dgData.channel.alternatives[0].confidence,
                words: dgData.channel.alternatives[0].words || []
              });
            }
          }
        } catch (error) {
          logger.error(`Error processing transcription for call ${callId}: ${error.message}`);
        }
      });

      return deepgramLive;
    } catch (error) {
      logger.error(`Error starting Deepgram STT session: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send audio data to the Deepgram STT service
   * @param {string} callId - Call identifier
   * @param {Buffer} audioData - Raw audio data to transcribe
   * @returns {boolean} - Success indicator
   */
  sendAudioForTranscription(callId, audioData) {
    try {
      const connection = this.sttConnections.get(callId);
      
      if (!connection) {
        logger.error(`No active STT connection found for call: ${callId}`);
        return false;
      }
      
      // Send the audio data to Deepgram
      if (connection.getReadyState() === WebSocket.OPEN) {
        connection.send(audioData);
        return true;
      } else {
        logger.warn(`STT connection not ready for call ${callId}, state: ${connection.getReadyState()}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error sending audio for transcription: ${error.message}`);
      return false;
    }
  }

  /**
   * End the STT session for a call
   * @param {string} callId - Call identifier
   */
  endSTTSession(callId) {
    try {
      const connection = this.sttConnections.get(callId);
      
      if (connection) {
        logger.info(`Closing Deepgram STT session for call: ${callId}`);
        connection.finish();
        this.sttConnections.delete(callId);
      }
    } catch (error) {
      logger.error(`Error ending STT session: ${error.message}`);
    }
  }

  /**
   * Generate speech from text using Deepgram TTS
   * @param {string} text - Text to convert to speech
   * @param {Object} options - TTS options (voice, etc.)
   * @returns {Promise<Buffer>} - Audio data
   */
  async textToSpeech(text, options = {}) {
    try {
      logger.info(`Converting text to speech: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      
      const voice = options.voice || process.env.BOT_VOICE || 'nova';
      
      // Call Deepgram TTS API
      const response = await this.deepgram.speak({
        text,
        voice,
        encoding: 'linear16',
        container: 'raw',
        sample_rate: 16000
      });
      
      // Return the audio buffer
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      logger.error(`Error in text-to-speech: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new DeepgramHandler();
