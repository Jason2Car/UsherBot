#!/usr/bin/env python3
"""Watches the Supabase `requests` table for rows with nav_status='pending'
and dispatches them as Nav2 navigate_to_pose goals."""

import os
import threading
import time

import rclpy
from action_msgs.msg import GoalStatus
from nav2_msgs.action import NavigateToPose
from rclpy.action import ActionClient
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from supabase import create_client

POLL_INTERVAL_SEC = 2.0
GOAL_TIMEOUT_SEC = 300.0

STATUS_LABEL = {
    GoalStatus.STATUS_SUCCEEDED: 'succeeded',
    GoalStatus.STATUS_ABORTED: 'aborted',
    GoalStatus.STATUS_CANCELED: 'canceled',
}


class Listener(Node):
    def __init__(self):
        super().__init__('robot_listener')
        self._client = ActionClient(self, NavigateToPose, 'navigate_to_pose')

    def send_goal_blocking(self, x: float, y: float) -> str:
        if not self._client.wait_for_server(timeout_sec=5.0):
            self.get_logger().error('navigate_to_pose action server not available')
            return 'failed'

        msg = NavigateToPose.Goal()
        msg.pose.header.frame_id = 'map'
        msg.pose.header.stamp = self.get_clock().now().to_msg()
        msg.pose.pose.position.x = float(x)
        msg.pose.pose.position.y = float(y)
        msg.pose.pose.orientation.w = 1.0

        send_future = self._client.send_goal_async(msg)
        if not _wait_done(send_future, timeout=10.0):
            return 'failed'
        handle = send_future.result()
        if not handle.accepted:
            return 'rejected'

        result_future = handle.get_result_async()
        if not _wait_done(result_future, timeout=GOAL_TIMEOUT_SEC):
            self.get_logger().warn('Goal timed out, canceling')
            handle.cancel_goal_async()
            return 'failed'
        return STATUS_LABEL.get(result_future.result().status, 'failed')


def _wait_done(future, timeout: float) -> bool:
    deadline = time.time() + timeout
    while not future.done() and time.time() < deadline:
        time.sleep(0.05)
    return future.done()


def claim_pending(supabase):
    rows = supabase.table('requests') \
        .select('*') \
        .eq('nav_status', 'pending') \
        .order('reserved_for') \
        .limit(1) \
        .execute()
    if not rows.data:
        return None
    candidate = rows.data[0]
    res = supabase.table('requests') \
        .update({'nav_status': 'navigating'}) \
        .eq('id', candidate['id']) \
        .eq('nav_status', 'pending') \
        .execute()
    if not res.data:
        return None
    return candidate


def poll_loop(listener: Listener, supabase):
    listener.get_logger().info(f'Polling every {POLL_INTERVAL_SEC}s')
    while rclpy.ok():
        try:
            row = claim_pending(supabase)
            if row:
                x, y = float(row['x_coord']), float(row['y_coord'])
                listener.get_logger().info(
                    f'Claimed {row["id"]} seat={row["seat_number"]} -> ({x}, {y})'
                )
                result = listener.send_goal_blocking(x, y)
                listener.get_logger().info(f'{row["id"]} -> {result}')
                update = {'nav_status': result}
                if result == 'succeeded':
                    update['checked_in'] = True
                supabase.table('requests') \
                    .update(update).eq('id', row['id']).execute()
        except Exception as e:
            listener.get_logger().error(f'poll loop error: {e}')
        time.sleep(POLL_INTERVAL_SEC)


def main():
    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_KEY')
    if not url or not key:
        raise SystemExit('Set SUPABASE_URL and SUPABASE_KEY env vars before running')

    supabase = create_client(url, key)

    rclpy.init()
    listener = Listener()
    listener.get_logger().info('robot_listener started')

    executor = MultiThreadedExecutor()
    executor.add_node(listener)
    threading.Thread(target=poll_loop, args=(listener, supabase), daemon=True).start()

    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        listener.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
