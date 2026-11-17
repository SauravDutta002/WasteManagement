/*
  EcoSort - NodeMCU (ESP8266) LED + buzzer controller
  Receives a command over USB serial (115200 baud) from the Python web app,
  lights the LED for the detected waste type and beeps the buzzer.

  Wiring:
    LED:    pin -> 220 ohm resistor -> LED long leg (+), LED short leg (-) -> GND
    Buzzer: + -> D7, - -> GND

    METAL   -> RED   LED -> D1 (GPIO5)   buzzer: 1 beep
    PLASTIC -> WHITE LED -> D2 (GPIO4)   buzzer: 2 beeps
    EWASTE  -> GREEN LED -> D6 (GPIO12)  buzzer: 3 beeps
    OTHER   -> all LEDs blink            buzzer: 1 long beep
    BUZZER  -> D7 (GPIO13)

  Commands (one per line): METAL PLASTIC EWASTE OTHER BEEP OFF TEST
*/

const int PIN_RED    = D1;
const int PIN_WHITE  = D2;
const int PIN_GREEN  = D6;
const int PIN_BUZZER = D7;

// true  = active buzzer (beeps by itself when powered; most 2-pin kit buzzers)
// false = passive buzzer (needs a tone signal). Change this if your buzzer only clicks.
const bool ACTIVE_BUZZER = true;
const int  BUZZER_FREQ   = 2500;  // Hz, used only for a passive buzzer

const int LED_PINS[] = {PIN_RED, PIN_WHITE, PIN_GREEN};
const int NUM_LEDS = sizeof(LED_PINS) / sizeof(LED_PINS[0]);

// How long an LED stays lit after a detection. 0 = stay on until the next command.
const unsigned long LED_ON_MS = 10000;

unsigned long litAt = 0;
bool ledLit = false;
String buffer = "";

void buzzerOn() {
  if (ACTIVE_BUZZER) digitalWrite(PIN_BUZZER, HIGH);
  else tone(PIN_BUZZER, BUZZER_FREQ);
}

void buzzerOff() {
  if (ACTIVE_BUZZER) digitalWrite(PIN_BUZZER, LOW);
  else noTone(PIN_BUZZER);
}

void beep(int times, int onMs, int offMs) {
  for (int i = 0; i < times; i++) {
    buzzerOn();
    delay(onMs);
    buzzerOff();
    if (i < times - 1) delay(offMs);
  }
}

void allOff() {
  for (int i = 0; i < NUM_LEDS; i++) digitalWrite(LED_PINS[i], LOW);
  ledLit = false;
}

void allOn() {
  for (int i = 0; i < NUM_LEDS; i++) digitalWrite(LED_PINS[i], HIGH);
}

void lightOnly(int pin) {
  allOff();
  digitalWrite(pin, HIGH);
  ledLit = true;
  litAt = millis();
}

void handleCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  if (cmd.length() == 0) return;

  // Reply first, then beep, so the web app gets its answer straight away.
  if (cmd == "METAL") {
    lightOnly(PIN_RED);
    Serial.println("OK METAL -> RED + 1 BEEP");
    beep(1, 250, 0);
  } else if (cmd == "PLASTIC") {
    lightOnly(PIN_WHITE);
    Serial.println("OK PLASTIC -> WHITE + 2 BEEPS");
    beep(2, 150, 150);
  } else if (cmd == "EWASTE") {
    lightOnly(PIN_GREEN);
    Serial.println("OK EWASTE -> GREEN + 3 BEEPS");
    beep(3, 120, 120);
  } else if (cmd == "OTHER") {
    Serial.println("OK OTHER -> BLINK ALL + LONG BEEP");
    buzzerOn();
    for (int t = 0; t < 3; t++) { allOn(); delay(200); allOff(); delay(200); }
    buzzerOff();
  } else if (cmd == "BEEP") {
    Serial.println("OK BEEP");
    beep(1, 300, 0);
  } else if (cmd == "OFF") {
    allOff();
    buzzerOff();
    Serial.println("OK OFF");
  } else if (cmd == "TEST") {
    Serial.println("OK TEST");
    for (int i = 0; i < NUM_LEDS; i++) { lightOnly(LED_PINS[i]); beep(1, 100, 0); delay(400); }
    allOn(); beep(1, 500, 0); delay(500); allOff();
  } else {
    Serial.print("ERR UNKNOWN ");
    Serial.println(cmd);
  }
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < NUM_LEDS; i++) {
    pinMode(LED_PINS[i], OUTPUT);
    digitalWrite(LED_PINS[i], LOW);
  }
  pinMode(PIN_BUZZER, OUTPUT);
  buzzerOff();
  delay(100);
  Serial.println();
  Serial.println("EcoSort NodeMCU ready");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      handleCommand(buffer);
      buffer = "";
    } else if (buffer.length() < 32) {
      buffer += c;
    }
  }

  if (LED_ON_MS > 0 && ledLit && millis() - litAt >= LED_ON_MS) {
    allOff();
  }
}
