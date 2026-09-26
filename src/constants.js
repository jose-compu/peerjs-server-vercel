export const MessageType = {
  OPEN: 'OPEN',
  LEAVE: 'LEAVE',
  CANDIDATE: 'CANDIDATE',
  OFFER: 'OFFER',
  ANSWER: 'ANSWER',
  EXPIRE: 'EXPIRE',
  HEARTBEAT: 'HEARTBEAT',
  ID_TAKEN: 'ID-TAKEN',
  ERROR: 'ERROR'
};

export const Errors = {
  INVALID_KEY: 'Invalid key provided',
  INVALID_TOKEN: 'Invalid token provided',
  INVALID_WS_PARAMETERS: 'No id, token, or key supplied to websocket server',
  CONNECTION_LIMIT_EXCEED: 'Server has reached its concurrent user limit'
};

export const RELAY_TYPES = new Set([
  MessageType.OFFER,
  MessageType.ANSWER,
  MessageType.CANDIDATE,
  MessageType.LEAVE,
  MessageType.EXPIRE
]);

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
