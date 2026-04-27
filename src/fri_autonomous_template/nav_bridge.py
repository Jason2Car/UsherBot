#!/usr/bin/env python3
import json
import subprocess
import threading
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

# We keep a minimal ROS node just for logging and health checks
import rclpy
from rclpy.node import Node

class NavBridge(Node):
    def __init__(self):
        super().__init__('nav_bridge')
        self._processes = {}  # Store process objects by goal_id
        self._lock = threading.Lock()

    def spawn_node(self, goal_id: str, x: float, y: float):
        self.get_logger().info(f"Launching follower_robot for Goal {goal_id} at ({x}, {y})")
        
        # Command: ros2 run follower_robot follower_robot <x> <y>
        cmd = ['ros2', 'run', 'follower_robot', 'follower_robot', str(x), str(y)]
        
        try:
            proc = subprocess.Popen(cmd)
            with self._lock:
                self._processes[goal_id] = proc
        except Exception as e:
            self.get_logger().error(f"Failed to launch node: {e}")

    def get_status(self, goal_id: str) -> dict:
        with self._lock:
            proc = self._processes.get(goal_id)
            if proc is None:
                return {'status': 'unknown'}
            
            # poll() returns None if process is still running
            exit_code = proc.poll()
            if exit_code is None:
                return {'status': 'running'}
            elif exit_code == 0:
                return {'status': 'completed'}
            else:
                return {'status': 'failed', 'exit_code': exit_code}

class Handler(BaseHTTPRequestHandler):
    bridge: NavBridge = None

    def _json(self, code: int, payload: dict):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def do_POST(self):
        if self.path == '/goal':
            length = int(self.headers.get('Content-Length', 0))
            try:
                body = json.loads(self.rfile.read(length))
                x, y = float(body['x']), float(body['y'])
            except:
                self._json(400, {'error': 'invalid json or coordinates'})
                return

            goal_id = uuid.uuid4().hex
            # Run the subprocess spawn in a thread so it doesn't block the HTTP response
            threading.Thread(target=self.bridge.spawn_node, args=(goal_id, x, y)).start()
            
            self._json(200, {'goal_id': goal_id, 'status': 'node_starting'})

    def do_GET(self):
        if self.path.startswith('/status/'):
            goal_id = self.path.rsplit('/', 1)[-1]
            self._json(200, self.bridge.get_status(goal_id))
        elif self.path == '/health':
            self._json(200, {'ok': True})

def main():
    rclpy.init()
    bridge = NavBridge()
    Handler.bridge = bridge
    server = HTTPServer(('0.0.0.0', 9090), Handler)
    
    print("HTTP Bridge Live on Port 9090")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    
    try:
        rclpy.spin(bridge)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        rclpy.shutdown()

if __name__ == '__main__':
    main()