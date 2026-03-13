const WebSocket = require("ws");

let wss = null;

function initWebSocket(server) {

  wss = new WebSocket.Server({ server });

  console.log("WebSocket ready.");

  wss.on("connection", (ws) => {

    console.log("Client connected");

    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (msg) => {
      console.log("WS message:", msg.toString());
    });

    ws.on("close", () => {
      console.log("Client disconnected");
    });

  });

  const interval = setInterval(() => {

    wss.clients.forEach((ws) => {

      if (!ws.isAlive) return ws.terminate();

      ws.isAlive = false;
      ws.ping();

    });

  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });

}

function broadcast(data) {

  if (!wss) return;

  wss.clients.forEach(client => {

    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }

  });

}

function getWSS() {
  return wss;
}

module.exports = {
  initWebSocket,
  broadcast,
  getWSS
};