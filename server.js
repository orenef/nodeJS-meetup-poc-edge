const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

let clients = [];

function calculateAverageBattery() {
    const totalBattery = clients.reduce((sum, client) => sum + client.batteryLevel, 0);
    return clients.length > 0 ? totalBattery / clients.length : 0;
}

function getLowBatteryClients() {
    return clients.filter(client => client.batteryLevel < 65);
}

function sendAverageBatteryToClient(ws) {
    const avgBatteryLevel = calculateAverageBattery();
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ avgBatteryLevel }));
    }
}

function broadcastAverageBattery() {
    const avgBatteryLevel = calculateAverageBattery();
    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ avgBatteryLevel }));
        }
    });
}

function broadcastLowBatteryClients() {
    const lowBatteryClients = getLowBatteryClients();
    const lowBatteryClientsCount = lowBatteryClients.length;

    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ lowBatteryClientsCount }));
            if (client.batteryLevel < 65) {
                client.ws.send(JSON.stringify({ message: "Use dark theme to save battery" }));
            }
        }
    });
}



// Broadcast the average battery level to all clients every 10 seconds
setInterval(broadcastAverageBattery, 10000);

// Broadcast the number of clients with battery level under 95% every 20 seconds
setInterval(broadcastLowBatteryClients, 20000);

// Setup our static files
app.use(express.static(path.join(__dirname, "public")));

// Use bodyParser to parse form submissions
app.use(bodyParser.urlencoded({ extended: true }));

// Our main GET home page route, serving an HTML page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "src/pages/index.html"));
});

// A POST route to handle form submissions
app.post("/", (req, res) => {
  // Handle form data here if needed
  // For now, just render the same page
  res.sendFile(path.join(__dirname, "src/pages/index.html"));
});

app.use(express.json());

let batteryData = [];
let averageBatteryLevel = 0;

// Route to receive battery data from the client
app.post('/report-battery', (req, res) => {
    const { batteryLevel } = req.body;

    // Add the battery level to the array
    batteryData.push(batteryLevel);

    // Calculate the new average battery level
    averageBatteryLevel = batteryData.reduce((acc, level) => acc + level, 0) / batteryData.length;

    console.log(`Received battery level: ${batteryLevel}%`);
    console.log(`New average battery level: ${averageBatteryLevel}%`);

    // Send the new average to the remote service for storage
    sendAverageToRemoteService(averageBatteryLevel);

    res.status(200).json({ status: `Battery level received. avg is now: ${averageBatteryLevel}`, avg: averageBatteryLevel });
});

// Function to send the average battery level to the remote service
function sendAverageToRemoteService(averageBatteryLevel) {
    const postData = JSON.stringify({ averageBatteryLevel });

    const options = {
        hostname: 'remote-service.local',
        port: 3001,
        path: '/store-average',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };
  console.log(postData);
    // const req = http.request(options, (res) => {
    //     console.log(`Remote service responded with status: ${res.statusCode}`);
    // });

//     req.on('error', (e) => {
//         console.error(`Problem with request: ${e.message}`);
//     });

//     req.write(postData);
//     req.end();
}


// Run the server and report out to the logs
const PORT = process.env.PORT || 3000;
const listener = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Your app is listening on http://0.0.0.0:${PORT}`);
});

const wss = new WebSocket.Server({
    path: "/wss",
    server: listener
});
wss.on('connection', (ws) => {
    let clientIndex = clients.length;
    clients.push({ ws, batteryLevel: 0 });

    ws.on('message', (message) => {
        const { batteryLevel } = JSON.parse(message);
        clients[clientIndex].batteryLevel = batteryLevel;

        // Send the average battery level to the new client upon connection
        sendAverageBatteryToClient(ws);
    });

    ws.on('close', () => {
        clients = clients.filter(client => client.ws !== ws);
    });
});