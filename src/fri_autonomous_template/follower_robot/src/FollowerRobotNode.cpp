#include "follower_robot/FollowerRobotNode.h"
#include <spatial_utils/transform_util.h>

#include <Eigen/Core>
#include <Eigen/Geometry>

#include <cmath>

using namespace std;

FollowerRobotNode::FollowerRobotNode(
    double target_x,
    double target_y):
    Node("follower_robot_node"),
    move_to_target_(this),
    tf_buffer_(this->get_clock()),
    tf_listener_(tf_buffer_),
    tf_broadcaster_(this),
    m_base_link_to_go_to_(Eigen::Matrix4d::Identity())
{
    // everytime timer fires (every 100 ms), computeAndAct is called
    timer_ = this->create_wall_timer(
        std::chrono::milliseconds(100),
        std::bind(&FollowerRobotNode::computeAndAct, this)
    );

    m_map_to_go_to_ = Eigen::MatrixXd::Identity(4, 4);

    // final angle that the robot will face
    double target_theta = M_PI / 2;
    Eigen::AngleAxisd rot(target_theta, Eigen::Vector3d::UnitZ());
    m_map_to_go_to_.block(0, 0, 3, 3) = rot.toRotationMatrix();

    // define target coordinates in the matrix
    m_map_to_go_to_(0, 3) = target_x;
    m_map_to_go_to_(1, 3) = target_y;
}

FollowerRobotNode::~FollowerRobotNode() {}

void FollowerRobotNode::computeAndAct() {
    try {
        // get the map-base link transform (where is the robot in the map?)
        geometry_msgs::msg::TransformStamped map_to_base_link =
            tf_buffer_.lookupTransform("map", "base_link", tf2::TimePointZero);

        // convert it to a matrix
        Eigen::MatrixXd m_map_to_base_link = transformToMatrix(map_to_base_link);

        // inverse reverses the relationship: map to base link -> base link to map
        Eigen::MatrixXd m_base_link_to_go_to = m_map_to_base_link.inverse() * m_map_to_go_to_;

        // Only send a goal if we're not already there
        double dx = m_base_link_to_go_to(0, 3);
        double dy = m_base_link_to_go_to(1, 3);
        if (std::sqrt(dx * dx + dy * dy) > 0.05) {
            move_to_target_.copyToGoalPoseAndSend(m_base_link_to_go_to);
        }

        // Broadcast goal frame using tf1
        geometry_msgs::msg::TransformStamped tf1 =
            matrixToTransform(m_map_to_go_to_, "map", "go_to");
        tf1.header.stamp = this->get_clock()->now();
        tf_broadcaster_.sendTransform(tf1);

    } catch (const tf2::TransformException &ex) {
        RCLCPP_WARN(this->get_logger(), "TF lookup failed: %s", ex.what());
    }
}