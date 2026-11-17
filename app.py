"""Smart Waste Management - Flask web app.

Upload a photo -> CLIP classifies it (metal / plastic / e-waste / other)
-> the matching LED on the NodeMCU lights up and the buzzer beeps, over USB serial.

Run:  python app.py   then open http://127.0.0.1:5000
"""
import threading
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from PIL import Image, UnidentifiedImageError

from classifier import CATEGORIES, WasteClassifier
from serial_controller import NodeMCU, list_ports

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024  # 15 MB uploads

classifier = WasteClassifier()
board = NodeMCU()
history = []  # recent results, newest first
stats = {k: 0 for k in list(CATEGORIES) + ["unknown"]}


def category_info():
    info = {k: {key: v[key] for key in ("label", "led", "bin", "tip")} for k, v in CATEGORIES.items()}
    info["unknown"] = {"label": "Unknown", "led": "Blink all + long beep", "bin": "Check manually",
                       "tip": "Try a clearer photo with a plain background."}
    return info


@app.route("/")
def index():
    return render_template("index.html")


SAMPLES_DIR = Path(app.static_folder) / "samples"


@app.get("/api/samples")
def samples():
    """Test images in static/samples. File names start with the expected category, e.g. metal_can.jpg."""
    items = []
    for f in sorted(SAMPLES_DIR.glob("*")):
        if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            expected, _, name = f.stem.partition("_")
            items.append({"url": f"/static/samples/{f.name}", "file": f.name,
                          "expected": expected, "name": name.replace("_", " ") or expected})
    return jsonify(items)


@app.get("/api/status")
def status():
    return jsonify({
        "model": classifier.status,
        "model_error": classifier.error,
        "device": classifier.device,
        "serial": {"connected": board.connected, "port": board.port},
        "ports": list_ports(),
        "categories": category_info(),
        "stats": stats,
        "history": history[:10],
    })


@app.post("/api/connect")
def connect():
    port = (request.get_json(silent=True) or {}).get("port")
    try:
        used = board.connect(port)
        return jsonify({"ok": True, "port": used})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/disconnect")
def disconnect():
    board.disconnect()
    return jsonify({"ok": True})


@app.post("/api/led")
def led():
    """Manually send a command (test buttons / manual override)."""
    cmd = (request.get_json(silent=True) or {}).get("command", "").upper()
    if cmd not in {"METAL", "PLASTIC", "EWASTE", "OTHER", "BEEP", "OFF", "TEST"}:
        return jsonify({"ok": False, "error": "Unknown command"}), 400
    try:
        return jsonify({"ok": True, "reply": board.send(cmd)})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/classify")
def classify():
    file = request.files.get("image")
    if not file:
        return jsonify({"ok": False, "error": "No image uploaded"}), 400
    try:
        image = Image.open(file.stream)
        image.load()
    except (UnidentifiedImageError, OSError):
        return jsonify({"ok": False, "error": "That file is not a valid image"}), 400

    try:
        result = classifier.classify(image)
    except RuntimeError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 503

    cat = result["category"]
    result["info"] = category_info()[cat]

    if board.connected:
        try:
            result["led"] = {"sent": True, "reply": board.send_category(cat)}
        except Exception as exc:  # noqa: BLE001
            result["led"] = {"sent": False, "error": str(exc)}
    else:
        result["led"] = {"sent": False, "error": "NodeMCU not connected"}

    stats[cat] += 1
    history.insert(0, {"category": cat, "confidence": result["confidence"],
                       "name": file.filename, "time": datetime.now().strftime("%H:%M:%S")})
    del history[20:]

    result["ok"] = True
    return jsonify(result)


def startup():
    threading.Thread(target=classifier.load, daemon=True).start()
    try:
        print(f"[serial] NodeMCU connected on {board.connect()}")
    except Exception as exc:  # noqa: BLE001
        print(f"[serial] Auto-connect failed: {exc}  (connect from the web UI)")


if __name__ == "__main__":
    startup()
    # use_reloader=False: the reloader would open the serial port twice
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
