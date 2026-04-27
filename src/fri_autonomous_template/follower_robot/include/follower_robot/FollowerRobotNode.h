#ifndef FOLLOWER_ROBOT_NODE_H
#define FOLLOWER_ROBOT_NODE_H

#include "follower_robot/MoveToTarget.h"

#include <geometry_msgs/msg/transform_stamped.hpp>
#include <rclcpp/rclcpp.hpp>
#include <tf2_ros/buffer.h>
#include <tf2_ros/transform_broadcaster.h>
#include <tf2_ros/transform_listener.h>
#include <Eigen/Dense>

class FollowerRobotNode : public rclcpp::Node {
public:
    FollowerRobotNode(
        double target_x = 5,
        double target_y = -5);
    ~FollowerRobotNode();

protected:
    void computeAndAct();

    Eigen::MatrixXd computeGoToFrameFromBaseLink(
        geometry_msgs::msg::TransformStamped &base_link_to_tag1);

    MoveToTarget move_to_target_;   

    tf2_ros::Buffer tf_buffer_;
    tf2_ros::TransformListener tf_listener_;
    tf2_ros::TransformBroadcaster tf_broadcaster_;

    Eigen::MatrixXd m_map_to_go_to_;
    rclcpp::TimerBase::SharedPtr timer_;
    Eigen::MatrixXd m_base_link_to_go_to_;

};

#endif
    