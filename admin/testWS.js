const WebSocket = require('ws');

// Create a WebSocket client
const ws = new WebSocket('ws://localhost:4001'); // Local admin server (HTTP + WS on same port)

ws.on('open', () => {
    console.log('WebSocket client: Connected to server');

    // Sample sequence for one table:
    // 2 -> help starts, 1 -> yes, 0 -> no, 3 -> help ends
    // Change table ID to one that maps to an active scheduled lab.
    const dataPoints = [
        '3304\t2',
        '3307\t2',
        '3317\t2',
        '3316\t2',
    ];

    dataPoints.forEach((data, index) => {
        setTimeout(() => {
            ws.send(data);
            console.log(`WebSocket client: Sent message ${data}`);
        }, index * 1000); // Send each data point 1 second apart
    });
});

ws.on('message', message => {
    console.log(`WebSocket client: Received message => ${message}`);
});

ws.on('close', () => {
    console.log('WebSocket client: Connection closed');
});

ws.on('error', error => {
    console.error(`WebSocket client: Error => ${error.message}`);
});