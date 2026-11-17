"""Talks to the NodeMCU over USB serial.

The port is kept open between commands, because opening it resets the ESP8266.
"""
import threading
import time

import serial
import serial.tools.list_ports

BAUD = 115200

# category -> command understood by nodemcu/waste_led/waste_led.ino
COMMANDS = {
    "metal": "METAL",
    "plastic": "PLASTIC",
    "ewaste": "EWASTE",
    "other": "OTHER",
    "unknown": "OTHER",
}


def list_ports():
    return [{"device": p.device, "description": p.description} for p in serial.tools.list_ports.comports()]


def guess_nodemcu_port():
    """Pick the most likely NodeMCU port (CH340 / CP210x USB-serial chips)."""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = f"{p.description} {p.manufacturer or ''}".upper()
        if any(chip in desc for chip in ("CH340", "CH341", "CP210", "USB-SERIAL", "USB SERIAL")):
            return p.device
    return ports[0].device if ports else None


class NodeMCU:
    def __init__(self):
        self.ser = None
        self.port = None
        self._lock = threading.Lock()

    @property
    def connected(self):
        return self.ser is not None and self.ser.is_open

    def connect(self, port=None):
        with self._lock:
            self._close()
            port = port or guess_nodemcu_port()
            if not port:
                raise RuntimeError("No serial ports found. Is the NodeMCU plugged in?")
            # 3 s timeout: the board may still be busy blinking/beeping from the previous command
            self.ser = serial.Serial(port, BAUD, timeout=3)
            self.port = port
            time.sleep(2)  # board resets on connect; wait for it to boot
            self.ser.reset_input_buffer()
        return port

    def disconnect(self):
        with self._lock:
            self._close()

    def _close(self):
        if self.ser is not None:
            try:
                self.ser.close()
            except Exception:  # noqa: BLE001
                pass
        self.ser = None
        self.port = None

    def send(self, command: str) -> str:
        with self._lock:
            if not self.connected:
                raise RuntimeError("NodeMCU not connected")
            try:
                self.ser.reset_input_buffer()
                self.ser.write((command + "\n").encode())
                self.ser.flush()
                reply = self.ser.readline().decode(errors="ignore").strip()
            except serial.SerialException as exc:
                self._close()
                raise RuntimeError(f"Serial error: {exc}") from exc
        return reply or "(no reply)"

    def send_category(self, category: str) -> str:
        return self.send(COMMANDS.get(category, "OTHER"))
