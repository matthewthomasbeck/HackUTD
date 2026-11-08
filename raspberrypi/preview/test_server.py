import json
import os
import select
import socket
import struct
import tempfile
import threading
import time
import sys
from types import SimpleNamespace
import unittest
import urllib.error
import urllib.request
import zlib
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import Latest, capture_camera, handler_for, jpeg_frames, parse_thermal_line, read_thermal, receive_pico, thermal_png, thermal_stats, publish_thermal


class PreviewTests(unittest.TestCase):
    def test_auto_contrast_keeps_measured_temperatures_and_limits_noise_amplification(self):
        args = SimpleNamespace(thermal_min_c=20, thermal_max_c=40, thermal_flip_x=False, thermal_fixed_range=False)
        frame = {'width': 32, 'height': 24, 'centi_deg_c': [2400] * 768}
        slot = Latest()
        publish_thermal(args, slot, frame)
        info = slot.get()[3]
        self.assertEqual((info['display_min_c'], info['display_max_c']), (22, 26))
        frame['centi_deg_c'][400] = 3500
        publish_thermal(args, slot, frame)
        info = slot.get()[3]
        self.assertEqual(info['max_c'], 35)
        self.assertEqual(info['background_c'], 24)
        self.assertGreaterEqual(info['display_max_c'] - info['display_min_c'], 4)
        self.assertEqual(info['range_mode'], 'auto')
        args.thermal_fixed_range = True
        publish_thermal(args, slot, frame)
        info = slot.get()[3]
        self.assertEqual((info['display_min_c'], info['display_max_c']), (20, 40))

    def test_temperature_summary_uses_measurements_and_matches_flipped_image(self):
        frame = {'width': 3, 'height': 2, 'centi_deg_c': [2000, 2100, 2200, 2300, 3500, 2400]}
        info = thermal_stats(frame)
        self.assertEqual((info['min_c'], info['max_c'], info['background_c']), (20, 35, 23))
        self.assertEqual((info['peak_col'], info['peak_row']), (1, 1))
        frame['centi_deg_c'][3] = 4000
        self.assertEqual(thermal_stats(frame, flip_x=True)['peak_col'], 2)

    def test_standalone_captures_camera_and_pico_simultaneously(self):
        camera, thermal, stop = Latest(), Latest(), threading.Event()
        master, slave = os.openpty()
        workers = []
        try:
            with tempfile.TemporaryDirectory() as directory:
                fake_camera = Path(directory) / 'fake-camera'
                fake_camera.write_text(f'#!{sys.executable}\nimport os,time\nwhile True:\n os.write(1,b"\\xff\\xd8camera\\xff\\xd9")\n time.sleep(.02)\n')
                fake_camera.chmod(0o755)
                args = SimpleNamespace(thermal_device=os.ttyname(slave), thermal_min_c=20,
                                       thermal_max_c=40, thermal_flip_x=False,
                                       camera_binary=str(fake_camera), width=640, height=480, fps=10)
                workers = [threading.Thread(target=receive_pico, args=(args, thermal, stop)),
                           threading.Thread(target=capture_camera, args=(args, camera, stop))]
                for worker in workers:
                    worker.start()
                self.assertTrue(select.select([master], [], [], 3)[0], 'Pico STREAM command missing')
                self.assertIn(b'STREAM 1', os.read(master, 1024))
                line = b'THM 123 4 25.0 20.0 40.0 ' + b' '.join([b'253'] * 768) + b'\n'
                os.write(master, line)
                deadline = time.monotonic() + 2
                while (camera.get() is None or thermal.get() is None) and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertIsNotNone(camera.get(), 'camera never produced a frame')
                self.assertIsNotNone(thermal.get(), 'thermal never produced a frame')
                self.assertEqual(camera.get()[0], b'\xff\xd8camera\xff\xd9')
                self.assertTrue(thermal.get()[0].startswith(b'\x89PNG'))
                stop.set()
                for worker in workers:
                    worker.join(timeout=4)
                    self.assertFalse(worker.is_alive())
        finally:
            stop.set()
            for worker in workers:
                worker.join(timeout=4)
            os.close(master)
            os.close(slave)

    def test_pico_tcp_units_and_shape(self):
        line = b'THM 123 4 25.0 20.0 40.0 ' + b' '.join([b'253'] * 768)
        frame = parse_thermal_line(line)
        self.assertEqual((frame['width'], frame['height']), (32, 24))
        self.assertEqual(frame['centi_deg_c'], [2530] * 768)
        with self.assertRaises(ValueError):
            parse_thermal_line(line.rsplit(b' ', 1)[0])

    def test_png_pixels_and_orientation(self):
        frame = {"width": 2, "height": 1, "centi_deg_c": [2000, 4000]}
        normal = thermal_png(frame)
        self.assertEqual(normal[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", normal[16:24]), (2, 1))

        def pixels(png):
            pos = png.index(b"IDAT")
            size = struct.unpack(">I", png[pos - 4:pos])[0]
            return zlib.decompress(png[pos + 4:pos + 4 + size])

        self.assertEqual(pixels(normal), b"\0\x08\x10\x30\xff\xff\xff")
        self.assertEqual(pixels(thermal_png(frame, flip_x=True)), b"\0\xff\xff\xff\x08\x10\x30")
        with self.assertRaises(ValueError):
            thermal_png({**frame, "centi_deg_c": [2000]})

    def test_jpeg_split_across_reads_and_garbage(self):
        class Chunks:
            def __init__(self):
                self.parts = iter([b"garbage\xff", b"\xd8one\xff", b"\xd9\xff\xd8two\xff\xd9", b""])

            def read(self, size):
                return next(self.parts)

        self.assertEqual(list(jpeg_frames(Chunks())), [b"\xff\xd8one\xff\xd9", b"\xff\xd8two\xff\xd9"])

    def test_http_refuses_stale_frame_and_recovers(self):
        camera, thermal, vision = Latest(), Latest(), Latest()
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(camera, thermal, "http://dashboard", vision))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/thermal.png"
        try:
            thermal.put(b"old", "image/png", age_s=3)
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(url)
            self.assertEqual(error.exception.code, 503)
            thermal.put(b"new", "image/png")
            with urllib.request.urlopen(url) as response:
                self.assertEqual(response.read(), b"new")
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://dashboard")
                etag = response.headers['ETag']
                self.assertEqual(response.headers['X-Thermal-Range-C'], '20,40')
            request = urllib.request.Request(url, headers={'If-None-Match': etag})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 304)
            # A stale image must fail even if its ETag matches.
            thermal.put(b'old', 'image/png', age_s=3)
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 503)
            preflight = urllib.request.Request(url, method='OPTIONS')
            with urllib.request.urlopen(preflight) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers['Access-Control-Allow-Headers'], 'If-None-Match')
            # Raw camera availability must never masquerade as model output.
            camera.put(b"raw", "image/jpeg")
            vision_url = url.replace("thermal.png", "vision.jpg")
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(vision_url)
            self.assertEqual(error.exception.code, 503)
            vision.put(b"annotated", "image/jpeg")
            with urllib.request.urlopen(vision_url) as response:
                self.assertEqual(response.read(), b"annotated")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_socket_uses_only_read_only_command_and_rejects_stale(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "control.sock")
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
                listener.bind(path)
                listener.listen()
                commands = []

                def serve():
                    connection, _ = listener.accept()
                    with connection:
                        commands.append(connection.recv(1024))
                        connection.sendall(json.dumps({"ok": True, "age_ms": 3000}).encode() + b"\n")

                thread = threading.Thread(target=serve)
                thread.start()
                with self.assertRaisesRegex(ValueError, "stale"):
                    read_thermal(path)
                thread.join()
                self.assertEqual(commands, [b'{"cmd":"thermal_frame"}\n'])


if __name__ == "__main__":
    unittest.main()
