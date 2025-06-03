const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const logger = require('./utils/logger');

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
      const sipUri = `sip:${phoneNumber}@${sipDomain}`;
      
      // Create the SIP participant through LiveKit's PSTN integration
      const result = await this.roomService.createSIPParticipant({
        roomName,
        uri: sipUri,
        audio: true,
        simulcast: false
      });
      
      logger.info(`Outbound call placed successfully: ${JSON.stringify(result)}`);
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
