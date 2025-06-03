const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const logger = require('./utils/logger');
const fetch = require('node-fetch'); // Add this dependency for making HTTP requests

class LiveKitClient {
  constructor() {
    this.apiKey = process.env.LIVEKIT_API_KEY;
    this.apiSecret = process.env.LIVEKIT_API_SECRET;
    this.url = process.env.LIVEKIT_URL;
    this.roomService = new RoomServiceClient(this.url, this.apiKey, this.apiSecret);
  }

  /**
   * Create a new room or get an existing one
   * @param {string} roomName - Unique room identifier
   * @returns {Promise<Object>} - Room details
   */
  async createOrGetRoom(roomName) {
    try {
      logger.info(`Creating or getting room: ${roomName}`);
      let room;
      
      try {
        // Try to get the room first
        room = await this.roomService.getRoom(roomName);
        logger.info(`Room ${roomName} already exists`);
      } catch (error) {
        // Room doesn't exist, create it
        logger.info(`Room ${roomName} doesn't exist, creating new room`);
        room = await this.roomService.createRoom({
          name: roomName,
          emptyTimeout: 300, // 5 minutes
          
          maxParticipants: 2  // Caller and bot
        });
      }
      
      return room;
    } catch (error) {
      logger.error(`Error creating/getting room: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a LiveKit access token for a participant
   * @param {string} roomName - Room name
   * @param {string} participantName - Participant identifier
   * @param {boolean} isBot - Whether this is a bot participant
   * @returns {string} - JWT token
   */
  generateToken(roomName, participantName, isBot = false) {
    try {
      logger.info(`Generating token for ${participantName} in room ${roomName}`);
      
      const tokenOptions = {
        identity: participantName,
        name: participantName,
      };

      // Add bot-specific permissions if this is a bot
      if (isBot) {
        tokenOptions.metadata = JSON.stringify({ type: 'bot' });
      }

      const token = new AccessToken(
        this.apiKey,
        this.apiSecret,
        tokenOptions
      );

      token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
      
      return token.toJwt();
    } catch (error) {
      logger.error(`Error generating token: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Format a phone number to E.164 format (with + prefix)
   * @param {string} phoneNumber - The phone number to format
   * @returns {string} - The formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    // Remove any non-digit characters
    let digits = phoneNumber.replace(/\D/g, '');
    
    // If the number doesn't have a + prefix, add it
    // For US/Canada numbers without country code, add +1
    if (!phoneNumber.startsWith('+')) {
      if (digits.length === 10) { // US/Canada number without country code
        digits = `1${digits}`;
      }
      return `+${digits}`;
    }
    
    // Already has + prefix, just clean up any other non-digits
    return phoneNumber.replace(/[^\d+]/g, '');
  }

  /**
   * Place an outbound SIP call to the specified phone number
   * @param {string} roomName - The LiveKit room name to connect to
   * @param {string} phoneNumber - The phone number to call
   * @returns {Promise<Object>} - The result of the call
   */
  async placeOutboundCall(roomName, phoneNumber) {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      logger.info(`Placing outbound call to ${formattedPhone} in room ${roomName}`);
      
      // We need to use the SIP Participant API, not the Egress API
      // First, we need to know the SIP trunk ID (should be in environment variables)
      const sipTrunkId = process.env.LIVEKIT_SIP_TRUNK_ID;
      if (!sipTrunkId) {
        throw new Error('LIVEKIT_SIP_TRUNK_ID environment variable is not set. Please create an outbound trunk first.');
      }
      
      // Create a LiveKit participant token
      const participantIdentity = `sip_${Date.now()}`;
      const participantToken = this.generateToken(roomName, participantIdentity, false);
      
      // Use the LiveKit SIP Participant API
      const baseUrl = this.url.replace('wss://', 'https://');
      const sipUrl = `${baseUrl}/v1/sip/participants`;
      
      logger.info(`Making request to LiveKit SIP Participant API: ${sipUrl}`);
      
      // Prepare the request body according to the CreateSIPParticipant API
      const requestBody = {
        sip_trunk_id: sipTrunkId,
        sip_call_to: formattedPhone,  // Use the full E.164 format with + prefix
        room_name: roomName,
        participant_identity: participantIdentity,
        participant_name: `Phone Call ${formattedPhone}`,
        wait_until_answered: false,  // Don't block the API call
        play_dialtone: true,         // Play dial tone while connecting
      };
      
      // Generate a LiveKit access token for API authentication
      const { AccessToken } = require('livekit-server-sdk');
      const at = new AccessToken(this.apiKey, this.apiSecret, {
        identity: 'api_call',
        name: 'API Call'
      });
      const token = at.toJwt();

      logger.info(`Request body: ${JSON.stringify(requestBody)}`);
      
      // Make the API request to LiveKit SIP Participant API
      const response = await fetch(sipUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });
      
      // Handle API response
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`LiveKit SIP Participant API error: ${response.status} ${response.statusText}`);
        logger.error(`Error details: ${errorText}`);
        throw new Error(`LiveKit SIP call failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      // Process the response
      logger.info(`LiveKit SIP Participant API response: ${response.status} ${response.statusText}`);
      const responseText = await response.text();
      logger.info(`Response body: ${responseText}`);
      
      // Handle both JSON and non-JSON responses
      let responseBody = {};
      try {
        responseBody = JSON.parse(responseText);
      } catch (e) {
        // If not JSON, just use the text
        responseBody = { message: responseText };
      }
      
      // Return success with details
      return {
        status: 'success',
        roomName,
        phoneNumber: formattedPhone,
        participantIdentity,
        timestamp: new Date().toISOString(),
        response: responseBody
      };
    } catch (error) {
      logger.error(`Error placing outbound call: ${error.message}`);
      throw error;
    }
  }

  /**
   * Disconnect a participant from a room
   * @param {string} roomName - Room name
   * @param {string} participantIdentity - Participant to remove
   * @returns {Promise<void>}
   */
  async disconnectParticipant(roomName, participantIdentity) {
    try {
      logger.info(`Disconnecting participant ${participantIdentity} from room ${roomName}`);
      await this.roomService.removeParticipant(roomName, participantIdentity);
      logger.info(`Participant ${participantIdentity} disconnected successfully`);
    } catch (error) {
      logger.error(`Error disconnecting participant: ${error.message}`);
      throw error;
    }
  }

  /**
   * End a room session and disconnect all participants
   * @param {string} roomName - Room to end
   * @returns {Promise<void>}
   */
  async endRoom(roomName) {
    try {
      logger.info(`Ending room: ${roomName}`);
      await this.roomService.deleteRoom(roomName);
      logger.info(`Room ${roomName} ended successfully`);
    } catch (error) {
      logger.error(`Error ending room: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new LiveKitClient();
