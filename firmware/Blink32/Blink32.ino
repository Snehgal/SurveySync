#include <WiFi.h>
#include <WebSocketsClient.h>
#include <WiFiManager.h>

// Use the computer's LAN address when testing with an ESP32, never localhost.
const char* webSocketServerAddress = "192.168.3.176";
const int webSocketPort = 4001;
const int LED = 2;
const int numDevices = 2;
const int tableIDs[numDevices] = {3416, 3417};
// Actual assignments from the supplied sketch: No/red, Help, Yes/green.
const int inputPins[numDevices][3] = {{23, 21, 19}, {27, 12, 13}};
const unsigned long debounceMs = 35;
WebSocketsClient webSocket;

struct ButtonState {
  int candidate = HIGH;
  int stable = HIGH;
  unsigned long changedAt = 0;
};
ButtonState buttons[numDevices][3];
unsigned long ledStartedAt = 0;
bool ledOn = false;

void setupWifi() {
  WiFiManager manager;
  if (!manager.autoConnect("ESP32-Config", "surveysync")) ESP.restart();
}

void sendData(int tableID, int value) {
  if (!webSocket.isConnected()) {
    Serial.println("Offline: input not sent. Press again after reconnecting.");
    return;
  }
  String message = String(tableID) + "\t" + String(value);
  webSocket.sendTXT(message);
  Serial.println(message);
  digitalWrite(LED, HIGH);
  ledStartedAt = millis();
  ledOn = true;
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) {
    Serial.println("Connected to SurveySync");
    sendData(1111, -1);
    // Clear any help left open when a release occurred during disconnection.
    // Reconcile Help only; never replay old Yes/No into another quiz or mode.
    for (int device = 0; device < numDevices; device++) {
      sendData(tableIDs[device], digitalRead(inputPins[device][1]) == LOW ? 2 : 3);
    }
  } else if (type == WStype_DISCONNECTED) {
    Serial.println("Disconnected. Waiting to reconnect...");
  } else if (type == WStype_TEXT) {
    Serial.printf("Server: %.*s\n", (int)length, payload);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  for (int device = 0; device < numDevices; device++) {
    for (int button = 0; button < 3; button++) pinMode(inputPins[device][button], INPUT_PULLUP);
  }
  setupWifi();
  webSocket.begin(webSocketServerAddress, webSocketPort, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) setupWifi();
  webSocket.loop();
  const unsigned long now = millis();
  for (int device = 0; device < numDevices; device++) {
    for (int button = 0; button < 3; button++) {
      ButtonState& state = buttons[device][button];
      const int reading = digitalRead(inputPins[device][button]);
      if (reading != state.candidate) { state.candidate = reading; state.changedAt = now; }
      if (now - state.changedAt < debounceMs || state.stable == state.candidate) continue;
      state.stable = state.candidate;
      if (button == 1) sendData(tableIDs[device], state.stable == LOW ? 2 : 3);
      else if (state.stable == LOW) sendData(tableIDs[device], button == 2 ? 1 : 0);
    }
  }
  if (ledOn && now - ledStartedAt >= 100) { digitalWrite(LED, LOW); ledOn = false; }
  delay(1);
}
