#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>

#define LED D0

// WebSocket server address
const char* webSocketServerAddress = "esp8266-control.onrender.com"; // Server URL (no need to specify port for wss)
const char* webSocketServerPath = "/"; // Path if applicable (change if required)

// Ping-Pong state
bool sendPing = true;
unsigned long lastMessageTime = 0;
const unsigned long interval = 2000; // 2 seconds interval for messages

// Create WebSocket client object
WebSocketsClient webSocket;

// Device settings
const int numDevices = 4; // Number of devices connected
const int moduleID = 1000; // Base ID for devices
int ids[numDevices];
int response[numDevices];

// Debouncing
const int debounceDelay = 50;  // Debounce time in milliseconds
unsigned long lastDebounceTime[numDevices] = {0};  // Last debounce time
int lastButtonState[numDevices] = {HIGH};  // Previous state of the button
int buttonState[numDevices] = {HIGH};  // Current state of the button

// Setup function for IDs
void setupID() {
  for (int i = 0; i < numDevices; i++) {
    ids[i] = moduleID + i + 1; // Adjust ID assignment
    response[i] = -1;
  }
}

void blinkLights(int n,int d){
  for(int i=0;i<n;i++){
    digitalWrite(LED, LOW);  // Turn the LED ON (active LOW)
    delay(d);                     // Wait for 500 milliseconds
    digitalWrite(LED, HIGH); // Turn the LED OFF
    delay(d);   
  }
}

void setupWifi(){
  digitalWrite(LED, LOW);
  Serial.println("WiFi Setup");
  WiFiManager wifiManager;
  // Automatically start configuration portal if no WiFi is saved
  if (!wifiManager.autoConnect("ESP8266-Config","surveysync")) {
    Serial.println("Failed to connect and hit timeout");
    delay(3000);
    ESP.restart(); // Restart the device after timeout
  }
  // If connected, print the IP address
  Serial.println("Connected to WiFi!");
  blinkLights(2,500);
  Serial.println("IP Address: ");
  Serial.println(WiFi.localIP());

  // Manual WiFi connection
  /*Serial.println("Connecting to WiFi...");
  WiFi.begin(ssid, password); //fill ssid, pass
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.print(".");
  }

  Serial.println("\nConnected to WiFi");
  blinkLights(2,500);
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());*/
}

void setup() {
  setupID();
  Serial.begin(115200);
    // Setup input pins
  pinMode(LED, OUTPUT);
  pinMode(D1, INPUT_PULLUP);
  pinMode(D2, INPUT_PULLUP);
  pinMode(D3, INPUT_PULLUP);
  pinMode(D4, INPUT_PULLUP);
  pinMode(D5, INPUT_PULLUP);
  pinMode(D6, INPUT_PULLUP);
  pinMode(D7, INPUT_PULLUP);
  pinMode(3, INPUT_PULLUP); // RX pin (GPIO3) as input
  
  setupWifi();

  // Initialize WebSocket with SSL (secure connection using port 443 for wss)
  webSocket.beginSSL(webSocketServerAddress, 443, webSocketServerPath); // Port 443 for SSL (wss://)
  webSocket.onEvent(webSocketEvent);
  Serial.println("WebSocket client started.");
}

void sendData(int id, int value) {
  if(id == 1) { id = 1001; }  // Adjust ID for first device
  String dataToSend = String(id) + "\t" + String(value);
  webSocket.sendTXT(dataToSend);
  Serial.print("Sent: ");
  Serial.println(dataToSend);
  blinkLights(1,100);
}

int lastValue;
void decryptInput(int a, int b, int id) {
  int value;
  if (a == 0 && b == 0) {
    value = 2; // Help
  } else if (a == 0) {
    value = 0; // No
  } else if (b == 0) {
    value = 1; // Yes
  } else {
    value = -1; // No action if no valid input
  }

  lastValue = response[id - moduleID];

  if (lastValue == 2 && value != 2) {
    sendData(id, 2);  // Send Help status
    if (value != -1) {
      sendData(id, value);  // Send the actual value (Yes/No)
    }
    response[id - moduleID] = value;
    return;
  }

  if (lastValue != value && value != -1) {
    sendData(id, value);
    response[id - moduleID] = value;
  }
}

int reconnectAttempts = 0;
void loop() {

  // wifi disconnect logic
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Attempting to reconnect...");
    reconnectAttempts++;

    // Retry 5 times before restarting
    if (reconnectAttempts > 5) {
      Serial.println("Max reconnect attempts reached. Restarting...");
      ESP.restart();
    }

    delay(2000); // Wait 2 seconds before retrying
    setupWifi(); // Attempt to reconnect
  } else {
    reconnectAttempts = 0; // Reset attempts if connected
  }

  int a = 1;
  int b = 1;
  // First module button RX, D2
  a = digitalRead(3);
  b = digitalRead(D1);
  decryptInput(a, b, ids[0]);
  
  a = 1; b = 1;
  // Second module button D3, D4
  a = digitalRead(D2);
  b = digitalRead(D3);
  decryptInput(a, b, ids[1]);

  a = 1; b = 1;
  // Third module button D5, D6
  a = digitalRead(D4);
  b = digitalRead(D5);
  decryptInput(a, b, ids[2]);

  a = 1; b = 1;
  // Fourth module button D7, D8
  a = digitalRead(D6);
  b = digitalRead(D7);
  decryptInput(a, b, ids[3]);

  // Handle WebSocket communication
  webSocket.loop();
  
  delay(50);  // Polling interval
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi disconnected. Attempting to reconnect...");
        setupWifi();
      }
      Serial.println("WebSocket Disconnected! Attempting to reconnect...");
      Serial.printf("Payload length: %u\n", length);
      // delay(10000); // Wait 10 seconds before reconnecting
      blinkLights(10,1000); // 10 seconds
      webSocket.beginSSL(webSocketServerAddress, 443, webSocketServerPath);
      webSocket.onEvent(webSocketEvent);
      break;
    case WStype_CONNECTED:
      Serial.printf("WebSocket Connected to %s\n", webSocketServerAddress);
      blinkLights(3,500);
      sendData(1111, -1);  // Send initial message or test data
      break;
    case WStype_TEXT:
      Serial.printf("Received text: %s\n", payload);
      break;
    case WStype_ERROR:
      Serial.println("WebSocket Error occurred!");
      break;
  }
}
