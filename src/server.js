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
  try {
    const { roomName, participantIdentity } = req.body;
    
    if (!roomName || !participantIdentity) {
      return res.status(400).json({ error: 'Room name and participant identity are required' });
    }
    
    // Handle the inbound call
    const callDetails = await callManager.handleInboundCall(roomName, participantIdentity);
    
    res.json({
      success: true,
      callId: callDetails.callId,
      roomName: callDetails.roomName,
      botIdentity: callDetails.botIdentity
    });
  } catch (error) {
    logger.error(`Error handling inbound SIP call: ${error.message}`);
    res.status(500).json({ error: error.message });
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
