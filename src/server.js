require('dotenv').config();
const express = require('express');
const cors = require('cors');
const logger = require('./utils/logger');
const livekitClient = require('./livekitClient');
const callManager = require('./callManager');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes

/**
 * Initiate an outbound call
 * POST /api/calls/outbound
 * 
 * Request body:
 * {
 *   "phoneNumber": "+12345678901",
 *   "initialContext": "Optional context for the LLM"
 * }
 */
app.post('/api/calls/outbound', async (req, res) => {
  try {
    const { phoneNumber, initialContext } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    // Initiate outbound call
    const callDetails = await callManager.initiateOutboundCall(phoneNumber, {
      initialContext
    });
    
    res.json({
      success: true,
      callId: callDetails.callId,
      roomName: callDetails.roomName
    });
  } catch (error) {
    logger.error(`Error initiating outbound call: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get details for a specific call
 * GET /api/calls/:callId
 */
app.get('/api/calls/:callId', (req, res) => {
  try {
    const { callId } = req.params;
    const callDetails = callManager.getCallDetails(callId);
    
    if (!callDetails) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    res.json(callDetails);
  } catch (error) {
    logger.error(`Error getting call details: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * List all active calls
 * GET /api/calls
 */
app.get('/api/calls', (req, res) => {
  try {
    const calls = callManager.getAllActiveCalls();
    res.json(calls);
  } catch (error) {
    logger.error(`Error listing calls: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * End a specific call
 * POST /api/calls/:callId/end
 */
app.post('/api/calls/:callId/end', async (req, res) => {
  try {
    const { callId } = req.params;
    const success = await callManager.endCall(callId);
    
    if (!success) {
      return res.status(404).json({ error: 'Call not found or already ended' });
    }
    
    res.json({ success: true, message: `Call ${callId} ended successfully` });
  } catch (error) {
    logger.error(`Error ending call: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Handle inbound SIP call notification from LiveKit
 * This webhook would be called by LiveKit when a SIP call arrives
 * POST /webhooks/livekit/sip-call
 */
app.post('/webhooks/livekit/sip-call', async (req, res) => {
  // Log the entire incoming request body for debugging
  logger.info('Received LiveKit webhook POST request');
  logger.info(`Request Content-Type: ${req.headers['content-type']}`);
  
  logger.info('Inspecting req.body:');
  logger.info(`Event Type: ${req.body.event}`);
  logger.info(`Full Payload: ${JSON.stringify(req.body, null, 2)}`);

  try {
    const event = req.body.event;
    
    // TODO: Confirm the actual event name from LiveKit for SIP dispatch.
    // Common events could be 'room_started' if the dispatch rule creates the room,
    // or a more specific SIP event like 'sip_dispatch'.
    // For this example, we'll assume 'room_started' or a generic SIP event.
    // You might also want to check req.body.sip for SIP-specific details.

    if (event === 'room_started' || (req.body.sip && req.body.room)) { // Adjust this condition based on actual event
      const roomName = req.body.room?.name;
      // The participantIdentity from a LiveKit webhook for an incoming SIP call
      // is typically the identity of the SIP trunk participant itself, not your bot.
      // Let's capture it if available, it might be useful for callManager.
      const sipParticipantIdentity = req.body.participant?.identity || req.body.sip?.participant_identity;
      const callerId = req.body.sip?.from_display_name || req.body.sip?.from; // Example of extracting caller ID

      if (!roomName) {
        logger.error('Webhook received but roomName is missing in payload.');
        return res.status(400).json({ error: 'Room name is missing in webhook payload.' });
      }

      logger.info(`Processing inbound call for room: ${roomName}, SIP Participant: ${sipParticipantIdentity}, Caller: ${callerId}`);
      
      // Pass relevant information to callManager.
      // callManager will be responsible for getting the bot into this room.
      const callDetails = await callManager.handleInboundCall({
        roomName,
        sipParticipantIdentity, // Identity of the PSTN leg
        callerId,              // Who is calling
        webhookPayload: req.body // Pass the full payload if callManager needs more details
      });
      
      res.json({
        success: true,
        callId: callDetails.callId,
        roomName: callDetails.roomName,
        botIdentity: callDetails.botIdentity // This should be the identity of YOUR bot
      });

    } else {
      logger.warn(`Received unhandled LiveKit event type: ${event}`);
      res.status(200).json({ message: 'Webhook received, but event not handled by this logic.' });
    }

  } catch (error) {
    logger.error(`Error handling inbound SIP call webhook: ${error.message}`, error.stack);
    res.status(500).json({ error: 'Error processing webhook: ' + error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`LiveKit URL: ${process.env.LIVEKIT_URL}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  // Close any active connections, end calls, etc.
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  // Close any active connections, end calls, etc.
  process.exit(0);
});
