"""Concurrent ribbon-camera and thermal preview, with optional laptop model inference."""

import argparse
import json
import logging
import math
import os
import glob
import select
import shutil
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import zlib
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path

LOG = logging.getLogger("preview")
MAX_FRAME = 4 * 1024 * 1024


class Latest:
    def __init__(self):
        self.lock = threading.Lock()
        self.sample = None

    def put(self, data, content_type, age_s=0, metadata=None):
        with self.lock:
            self.sample = (data, content_type, time.monotonic() - age_s, metadata)

    def get(self, max_age_s=2):
        with self.lock:
            sample = self.sample
        if sample is None or time.monotonic() - sample[2] > max_age_s:
            return None
        return sample


@lru_cache(maxsize=1)
def thermal_palette():
    """Cool navy/blue through teal to warm yellow/white, without a red room background."""
    stops = [(0, (8, 16, 48)), (0.3, (37, 79, 160)), (0.6, (30, 190, 180)),
             (0.8, (255, 193, 70)), (1, (255, 255, 255))]
    colors = []
    for index in range(256):
        fraction = index / 255
        for (start, cold), (end, warm) in zip(stops, stops[1:]):
            if fraction <= end:
                blend = (fraction - start) / (end - start)
                colors.append(bytes(round(a + (b - a) * blend) for a, b in zip(cold, warm)))
                break
    return tuple(colors)


def thermal_png(frame, low_c=20, high_c=40, flip_x=False):
    """Fixed temperature scale, so a pixel's brightness stays comparable across frames."""
    width, height = frame["width"], frame["height"]
    values = frame["centi_deg_c"]
    if (type(width) is not int or type(height) is not int or not 1 <= width <= 64
            or not 1 <= height <= 64 or len(values) != width * height):
        raise ValueError("invalid thermal dimensions")
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
        raise ValueError("invalid thermal temperatures")
    rows = bytearray()
    palette = thermal_palette()
    scale = 255 / ((high_c - low_c) * 100)
    for y in range(height):
        rows.append(0)  # PNG filter: none
        for x in range(width):
            col = width - 1 - x if flip_x else x
            index = round((values[y * width + col] - low_c * 100) * scale)
            rows.extend(palette[max(0, min(255, index))])

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def thermal_stats(frame, flip_x=False):
    values = frame['centi_deg_c']
    peak = max(range(len(values)), key=values.__getitem__)
    width = frame['width']
    col = peak % width
    return {'min_c': min(values) / 100, 'max_c': values[peak] / 100,
            'background_c': sorted(values)[len(values) // 2] / 100,
            'peak_col': width - 1 - col if flip_x else col, 'peak_row': peak // width,
            'width': width, 'height': frame['height']}


def publish_thermal(args, slot, frame, age_s=0):
    """Auto contrast is display-only; measurements and robot thresholds stay untouched."""
    started = time.monotonic()
    info = thermal_stats(frame, args.thermal_flip_x)
    low, high = args.thermal_min_c, args.thermal_max_c
    auto = not getattr(args, 'thermal_fixed_range', False)
    if auto:
        values = sorted(frame['centi_deg_c'])
        low = values[int((len(values) - 1) * 0.02)] / 100 - 0.5
        high = values[int((len(values) - 1) * 0.98)] / 100 + 0.5
        if high - low < 4:
            center = (high + low) / 2
            low, high = center - 2, center + 2
        previous = slot.get()
        if previous and previous[3] and previous[3].get('range_mode') == 'auto':
            low = previous[3]['display_min_c'] * 0.85 + low * 0.15
            high = previous[3]['display_max_c'] * 0.85 + high * 0.15
        low, high = round(low, 1), round(high, 1)
    info.update(display_min_c=low, display_max_c=high, range_mode='auto' if auto else 'fixed')
    image = thermal_png(frame, low, high, args.thermal_flip_x)
    slot.put(image, 'image/png', age_s + time.monotonic() - started, info)


def read_thermal(path):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(0.75)
        client.connect(path)
        client.sendall(b'{"cmd":"thermal_frame"}\n')
        data = bytearray()
        while b"\n" not in data:
            packet = client.recv(8192)
            if not packet:
                raise ValueError("robot disconnected before replying")
            data.extend(packet)
            if len(data) > 65536:
                raise ValueError("oversized thermal reply")
    frame = json.loads(data.split(b"\n", 1)[0])
    if not frame.get("ok"):
        raise ValueError(frame.get("error", "thermal unavailable"))
    age = float(frame["age_ms"]) / 1000
    if not math.isfinite(age) or age < 0 or age > 2:
        raise ValueError("thermal frame is stale")
    return frame, age


def poll_thermal(args, slot, stop):
    while not stop.is_set():
        try:
            started = time.monotonic()
            frame, age = read_thermal(args.socket)
            publish_thermal(args, slot, frame, age + time.monotonic() - started)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            LOG.debug("thermal unavailable: %s", exc)
        stop.wait(0.25)


def parse_thermal_line(line):
    """Pico THM: uptime, sequence, ambient, min, max, then 768 pixels in tenths C."""
    fields = line.split()
    if len(fields) != 774 or fields[0] != b"THM":
        raise ValueError("invalid THM frame")
    pixels = [int(value) * 10 for value in fields[6:]]
    if any(value < -32768 or value > 32767 for value in pixels):
        raise ValueError("thermal temperature outside protocol range")
    return {"width": 32, "height": 24, "centi_deg_c": pixels}


def receive_thermal(args, slot, stop):
    """Connect to Matthew's existing thermal_stream.py; never open the Pico locally."""
    while not stop.is_set():
        try:
            with socket.create_connection((args.thermal_host, args.thermal_port), timeout=2) as connection:
                connection.settimeout(0.5)
                data = bytearray()
                while not stop.is_set():
                    try:
                        chunk = connection.recv(16384)
                    except socket.timeout:
                        continue
                    if not chunk:
                        break
                    data.extend(chunk)
                    # Render only the newest complete thermal line from this read.
                    newest = None
                    while b"\n" in data:
                        line, _, rest = data.partition(b"\n")
                        data = bytearray(rest)
                        if line.startswith(b"THM "):
                            newest = bytes(line)
                    if len(data) > 65536:
                        data.clear()
                    if newest is not None:
                        received = time.monotonic()
                        try:
                            frame = parse_thermal_line(newest)
                            publish_thermal(args, slot, frame, time.monotonic() - received)
                        except ValueError as exc:
                            LOG.debug("bad thermal frame: %s", exc)
        except OSError as exc:
            LOG.debug("thermal TCP unavailable: %s", exc)
        stop.wait(1)


def receive_pico(args, slot, stop):
    """Standalone preview owns the Pico, using the same text commands as thermal_stream.py.

    Do not run alongside the C++ robot or another serial reader. Robot-integrated mode
    still uses its control socket instead. Neither mode sends movement commands.
    """
    import termios
    import tty
    import fcntl

    while not stop.is_set():
        fd = None
        try:
            candidates = ([args.thermal_device] if args.thermal_device else
                          (["/dev/pico"] if Path("/dev/pico").exists() else sorted(glob.glob("/dev/serial/by-id/*Pico*"))))
            if not candidates:
                raise OSError("Pico not found; reconnect it or set --thermal-device")
            fd = os.open(candidates[0], os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
            # Kernel exclusivity prevents later opens while this capture owns the port.
            fcntl.ioctl(fd, termios.TIOCEXCL)
            tty.setraw(fd)
            termios.tcflush(fd, termios.TCIOFLUSH)
            LOG.info("thermal capture: %s", candidates[0])
            pending = bytearray()
            last_frame = last_ask = 0.0
            while not stop.is_set():
                now = time.monotonic()
                if now - last_frame > 2 and now - last_ask > 2:
                    os.write(fd, b"STREAM 1\r\n")
                    last_ask = now
                if not select.select([fd], [], [], 0.25)[0]:
                    continue
                chunk = os.read(fd, 16384)
                if not chunk:
                    raise OSError("Pico disconnected")
                pending.extend(chunk)
                newest = None
                while b"\n" in pending:
                    line, _, rest = pending.partition(b"\n")
                    pending = bytearray(rest)
                    if line.startswith(b"THM "):
                        newest = bytes(line)
                if len(pending) > 65536:
                    pending.clear()
                if newest is not None:
                    received = time.monotonic()
                    try:
                        frame = parse_thermal_line(newest)
                        publish_thermal(args, slot, frame, time.monotonic() - received)
                        last_frame = received
                    except ValueError as exc:
                        LOG.debug("bad thermal frame: %s", exc)
        except (OSError, ValueError) as exc:
            LOG.warning("Pico capture unavailable: %s; retrying", exc)
        finally:
            if fd is not None:
                try:
                    fcntl.ioctl(fd, termios.TIOCNXCL)
                except OSError:
                    pass
                os.close(fd)
        stop.wait(2)


def jpeg_frames(stream):
    """Split rpicam's concatenated JPEGs, keeping memory bounded on corrupt input."""
    data = bytearray()
    while True:
        packet = stream.read(16384)
        if not packet:
            return
        data.extend(packet)
        while True:
            start = data.find(b"\xff\xd8")
            if start < 0:
                data[:] = data[-1:]
                break
            if start:
                del data[:start]
            end = data.find(b"\xff\xd9", 2)
            if end < 0:
                break
            yield bytes(data[:end + 2])
            del data[:end + 2]
        if len(data) > MAX_FRAME:
            data.clear()


def capture_camera(args, slot, stop):
    binary = shutil.which(args.camera_binary)
    if not binary:
        LOG.error("%s is not installed; camera preview unavailable", args.camera_binary)
        return
    command = [binary, "--nopreview", "--timeout", "0", "--codec", "mjpeg",
               "--width", str(args.width), "--height", str(args.height),
               "--framerate", str(args.fps), "--output", "-"]
    while not stop.is_set():
        process = subprocess.Popen(command, stdout=subprocess.PIPE, bufsize=0)

        def terminate_on_stop():
            while process.poll() is None and not stop.wait(0.2):
                pass
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()

        monitor = threading.Thread(target=terminate_on_stop, daemon=True)
        monitor.start()
        try:
            for jpeg in jpeg_frames(process.stdout):
                slot.put(jpeg, "image/jpeg")
                if stop.is_set():
                    break
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()
            monitor.join(timeout=1)
        if not stop.is_set():
            LOG.warning("camera capture exited; retrying in 2 seconds")
            stop.wait(2)


def fetch_camera(url, slot, stop):
    etag = None
    while not stop.is_set():
        try:
            started = time.monotonic()
            request = Request(url, headers={"If-None-Match": etag} if etag else {})
            with urlopen(request, timeout=2) as response:
                data = response.read(MAX_FRAME + 1)
                age = float(response.headers.get("X-Frame-Age-Ms", "0")) / 1000
                if len(data) > MAX_FRAME or not data.startswith(b"\xff\xd8"):
                    raise ValueError("invalid camera JPEG")
                if not math.isfinite(age) or age < 0:
                    raise ValueError("invalid camera age")
                slot.put(data, "image/jpeg", age + time.monotonic() - started)
                etag = response.headers.get("ETag")
        except HTTPError as exc:
            if exc.code != 304:
                etag = None
                LOG.debug("remote camera unavailable: %s", exc)
        except (OSError, ValueError) as exc:
            LOG.debug("remote camera unavailable: %s", exc)
        stop.wait(0.1)


def annotate_jpeg(data, model, confidence):
    import cv2
    import numpy as np

    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("camera JPEG could not be decoded")
    results = model([image], conf=confidence, verbose=False)
    if not results:
        raise ValueError("model returned no result")
    ok, encoded = cv2.imencode(".jpg", results[0].plot())
    if not ok:
        raise ValueError("model frame could not be encoded")
    return encoded.tobytes()


def infer_camera(camera, vision, stop):
    # Reuse the primary perception service's configured model and fallback, not a second model definition.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend" / "perception"))
    try:
        from perception.config import load_config
        from perception.roi import load_model, loaded_model_name

        cfg = load_config()["breathing"]
        model = load_model(cfg)
        if model is None:
            raise RuntimeError("configured perception model could not load")
        LOG.info("live vision model: %s", loaded_model_name())
    except Exception:
        LOG.exception("vision unavailable; install perception dependencies and model weights")
        stop.set()  # Exit the worker process so Electron's supervisor can retry.
        return
    previous = None
    while not stop.is_set():
        sample = camera.get()
        if sample is None or sample[2] == previous:
            stop.wait(0.05)
            continue
        previous = sample[2]
        try:
            image = annotate_jpeg(sample[0], model, float(cfg.get("yolo_conf", 0.25)))
            vision.put(image, "image/jpeg", time.monotonic() - sample[2])
        except Exception:
            LOG.exception("live model inference failed")
            stop.wait(0.5)


def handler_for(camera, thermal, origin, vision=None, thermal_range=(20, 40)):
    class Handler(BaseHTTPRequestHandler):
        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "If-None-Match")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

        def do_GET(self):
            path = urlsplit(self.path).path
            slot = {"/camera.jpg": camera, "/thermal.png": thermal, "/vision.jpg": vision}.get(path)
            sample = slot.get() if slot else None
            etag = f'"{sample[2]:.9f}"' if sample else None
            if path == "/health":
                body = json.dumps({"camera": camera.get() is not None,
                                   "vision": vision is not None and vision.get() is not None,
                                   "thermal": thermal.get() is not None}).encode()
                status, content_type = 200, "application/json"
            elif slot is None:
                body, status, content_type = b"Not found", 404, "text/plain"
            elif sample is None:
                body, status, content_type = b"No fresh frame", 503, "text/plain"
            else:
                body, content_type = sample[:2]
                status = 200
                if self.headers.get("If-None-Match") == etag:
                    body, status = b"", 304
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Expose-Headers", "X-Frame-Age-Ms, ETag, X-Thermal-Range-C, X-Thermal-Stats, X-Thermal-Range-Mode")
            if sample:
                self.send_header("ETag", etag)
                self.send_header("X-Frame-Age-Ms", str(round((time.monotonic() - sample[2]) * 1000)))
                if path == "/thermal.png":
                    info = sample[3] or {}
                    low, high = info.get('display_min_c', thermal_range[0]), info.get('display_max_c', thermal_range[1])
                    self.send_header("X-Thermal-Range-C", f"{low:g},{high:g}")
                    self.send_header("X-Thermal-Range-Mode", info.get('range_mode', 'fixed'))
                    if sample[3]:
                        self.send_header("X-Thermal-Stats", json.dumps(sample[3], separators=(',', ':')))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, fmt, *args):
            LOG.debug(fmt, *args)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", default="/run/robot/control.sock")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--origin", default="*", help="Allowed dashboard origin")
    parser.add_argument("--camera-binary", default="rpicam-vid", help="Use libcamera-vid on older installations")
    parser.add_argument("--no-camera", action="store_true", help="Thermal-only laptop testing")
    parser.add_argument("--camera-url", help="Read Pi camera.jpg on the inference laptop instead of opening a local camera")
    parser.add_argument("--vision", action="store_true", help="Run the repo's perception model and serve /vision.jpg")
    parser.add_argument("--no-thermal", action="store_true", help="Inference laptop only; thermal stays on the Pi")
    thermal_source = parser.add_mutually_exclusive_group()
    thermal_source.add_argument("--thermal-host", help="Connect to the Pi's existing thermal_stream.py instead of the robot socket")
    thermal_source.add_argument("--standalone", action="store_true", help="Own Pico thermal and ribbon camera together; no C++ robot needed")
    parser.add_argument("--thermal-device", help="Serial path in standalone mode; otherwise discovers the Pico by stable name")
    parser.add_argument("--thermal-port", type=int, default=8889)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--fps", type=int, default=10)
    parser.add_argument("--thermal-min-c", type=float, default=20)
    parser.add_argument("--thermal-max-c", type=float, default=40)
    parser.add_argument("--thermal-fixed-range", action="store_true", help="Disable auto contrast and use thermal-min-c/max-c")
    parser.add_argument("--thermal-flip-x", action="store_true")
    args = parser.parse_args()
    if args.thermal_device and not args.standalone:
        parser.error("--thermal-device requires --standalone")
    if (not math.isfinite(args.thermal_min_c) or not math.isfinite(args.thermal_max_c)
            or args.thermal_max_c <= args.thermal_min_c or min(args.width, args.height, args.fps) <= 0):
        parser.error("invalid image dimensions, frame rate, or thermal scale")
    logging.basicConfig(level=logging.INFO)

    def stop_signal(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop_signal)
    camera, thermal, vision, stop = Latest(), Latest(), Latest(), threading.Event()
    server = ThreadingHTTPServer((args.host, args.port), handler_for(camera, thermal, args.origin, vision,
                                                                  (args.thermal_min_c, args.thermal_max_c)))
    workers = []
    if not args.no_thermal:
        thermal_worker = receive_pico if args.standalone else receive_thermal if args.thermal_host else poll_thermal
        workers.append(threading.Thread(target=thermal_worker, args=(args, thermal, stop), daemon=True))
    if args.camera_url:
        workers.append(threading.Thread(target=fetch_camera, args=(args.camera_url, camera, stop), daemon=True))
    elif not args.no_camera:
        workers.append(threading.Thread(target=capture_camera, args=(args, camera, stop), daemon=True))
    if args.vision:
        workers.append(threading.Thread(target=infer_camera, args=(camera, vision, stop), daemon=True))
    for worker in workers:
        worker.start()
    def shutdown_when_stopped():
        stop.wait()
        server.shutdown()

    threading.Thread(target=shutdown_when_stopped, daemon=True).start()
    LOG.info("preview listening on %s:%s", args.host, args.port)
    interrupted = False
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        interrupted = True
    finally:
        stop.set()
        server.server_close()
        for worker in workers:
            worker.join(timeout=4)
    if not interrupted:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
