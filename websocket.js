const WebSocket = require("ws");
let wss = null;

function initWebSocket(server) {
  wss = new WebSocket.Server({ server });
  console.log("WebSocket ready.");

  wss.on("connection", (ws) => {
    ws.on("message", (msg) => {
      console.log("WS message:", msg);
    });
  });
}

function getWSS() {
  return wss;
}

module.exports = { initWebSocket, getWSS };
