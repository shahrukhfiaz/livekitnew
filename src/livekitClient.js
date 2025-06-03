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
   * Place an outbound SIP call using LiveKit
   * @param {string} roomName - Room to connect the call to
   * @param {string} phoneNumber - Target phone number to dial
   * @returns {Promise<Object>} - Call details
   */
  async placeOutboundCall(roomName, phoneNumber) {
    try {
      logger.info(`Placing outbound call to ${phoneNumber} in room ${roomName}`);
      
      // Ensure room exists
      await this.createOrGetRoom(roomName);
      
      // Prepare SIP URI for Twilio SIP Trunk
      const sipDomain = process.env.TWILIO_SIP_DOMAIN;
      
      // Format phone number correctly - ensure it includes the + prefix
      const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
      
      // Format SIP URI according to Twilio's requirements
      // Use the 'to' parameter format that Twilio expects
      const sipUri = `sip:${formattedPhone}@${sipDomain}`;
      
      // Create the SIP participant using the appropriate method
      // Instead of using createSIPParticipant, we need to use the egress API
      // This works with LiveKit Cloud to create a SIP connection
      // LiveKit API v1 format requires this specific endpoint structure
      const egressUrl = `${this.url.replace('wss://', 'https://')}/twirp/livekit.Egress/StartSIPEgress`;
      
      // Format request body according to LiveKit API specifications
      // See: https://docs.livekit.io/reference/server-sdk/rest/StartSIPEgress
      const egressBody = {
        sip_uri: sipUri,
        room_name: roomName,
        enable_audio: true,
        api_key: this.apiKey,
        api_secret: this.apiSecret
      };
      
      // Make a direct HTTP request to the LiveKit egress API
      const response = await fetch(egressUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(egressBody)
      });
      
      if (!response.ok) {
        throw new Error(`LiveKit SIP egress failed: ${response.status} ${response.statusText}`);
      }
      
      // Handle text response from LiveKit API - it may not always return JSON
      const responseText = await response.text();
      logger.info(`Outbound call placed successfully: ${responseText}`);
      
      // Return a structured response object
      const result = {
        status: 'success',
        message: responseText,
        roomName,
        phoneNumber,
        timestamp: new Date().toISOString()
      };
      
      return result;
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
