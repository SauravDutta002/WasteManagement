# EcoSort: Smart Waste Management

Upload a photo of waste. The AI model (OpenAI CLIP, running locally on your laptop) works out what kind of waste it is. Then the NodeMCU lights the matching LED and beeps the buzzer, over USB.

| Waste type | LED | Pin | Buzzer |
|---|---|---|---|
| Metal | Red | D1 | 1 beep |
| Plastic | White | D2 | 2 beeps |
| E-waste (motherboards, phones, batteries…) | Green | D6 | 3 beeps |
| Other (paper, glass, food…) / unknown | All 3 blink | none | 1 long beep |

## 1. Wiring

- **Each LED:** pin → 220 Ω resistor → LED long leg (+), then LED short leg (−) → GND.
- **Buzzer:** + → **D7**, − → GND.

All parts share the NodeMCU's `GND` pin. If the buzzer only clicks instead of beeping, it's a passive buzzer. Set `ACTIVE_BUZZER = false` in the sketch and upload again.

## 2. Flash the NodeMCU

1. In the Arduino IDE, add the ESP8266 boards URL under *File → Preferences → Additional Boards Manager URLs*:
   `http://arduino.esp8266.com/stable/package_esp8266com_index.json`
2. Open *Tools → Board → Boards Manager*, then install **esp8266**.
3. Open `nodemcu/waste_led/waste_led.ino`. Select the board **NodeMCU 1.0 (ESP-12E Module)** and your port (e.g. `COM3`).
4. Upload. Then **close the Arduino Serial Monitor**, because only one program can use the COM port at a time.

## 3. Run the web app

```bash
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000. The app auto-connects to the NodeMCU (it detects CH340/CP210x chips). You can also choose the port in the **NodeMCU LEDs** card.

The first run downloads the CLIP model (~600 MB). After that it loads from cache.

## Tuning

- Add or adjust detection phrases in `CATEGORIES` in `classifier.py`. More specific prompts give better accuracy.
- `MIN_CONFIDENCE` in `classifier.py` sets how sure the model must be. Results below it count as "unknown".
- `LED_ON_MS` in the sketch sets how long an LED stays lit. Set it to `0` to keep the LED on until the next scan.
