"""Find and verify the running robot's read-only thermal-frame endpoint."""
import argparse
import json
import socket
import sys
from pathlib import Path


def probe(path):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(2)
        client.connect(str(path))
        client.sendall(b'{"cmd":"thermal_frame"}\n')
        data = bytearray()
        while b'\n' not in data:
            chunk = client.recv(8192)
            if not chunk:
                raise ValueError('robot disconnected without replying')
            data.extend(chunk)
            if len(data) > 65536:
                raise ValueError('reply too large')
    body = json.loads(data.split(b'\n', 1)[0])
    if body.get('ok') and 'centi_deg_c' in body:
        return True
    if body.get('error') == 'no thermal frame yet':
        print('Robot supports preview; waiting for its thermal sensor.', file=sys.stderr)
        return True
    raise ValueError('robot needs rebuilding with the thermal_frame endpoint')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('socket', nargs='?')
    args = parser.parse_args()
    paths = [Path(args.socket)] if args.socket else [Path('/run/robot/control.sock'), Path('/tmp/robot/control.sock')]
    for path in paths:
        if not path.exists():
            continue
        try:
            if probe(path):
                print(path)
                return
        except (OSError, ValueError, TypeError) as error:
            print(f'{path}: {error}', file=sys.stderr)
    sys.exit('No compatible robot socket found. Start the updated robot, or pass its control socket path.')


if __name__ == '__main__':
    main()
