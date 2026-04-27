#include "follower_robot/MoveToTarget.h"

MoveToTarget::MoveToTarget(rclcpp::Node *node) :
    node_(node),
    send_goal_options_(rclcpp_action::Client<nav2_msgs::action::NavigateToPose>::SendGoalOptions()) {
    client_ = rclcpp_action::create_client<nav2_msgs::action::NavigateToPose>(node, "navigate_to_pose");

    while (!client_->wait_for_action_server(std::chrono::seconds(5))) {
        RCLCPP_INFO(node_->get_logger(), "Waiting for Nav2 action server...");
    }

    send_goal_options_.goal_response_callback =
        std::bind(&MoveToTarget::goal_response_callback, this,
            std::placeholders::_1);
    send_goal_options_.result_callback =
        std::bind(&MoveToTarget::result_callback, this,
            std::placeholders::_1);
}

MoveToTarget::~MoveToTarget() {}

void MoveToTarget::goal_response_callback(
    std::shared_ptr<rclcpp_action::ClientGoalHandle<nav2_msgs::action::NavigateToPose>> goal_handle) {
    if (!goal_handle) {
        RCLCPP_ERROR(node_->get_logger(), "Goal was rejected!");
    } else {
        RCLCPP_INFO(node_->get_logger(), "Goal accepted!");
    }
}    

void MoveToTarget::result_callback(
    const rclcpp_action::ClientGoalHandle<nav2_msgs::action::NavigateToPose>::WrappedResult &result) {
}

// This looks good - Jason
void MoveToTarget::copyToGoalPoseAndSend(
    Eigen::MatrixXd &goal_pose_relative_to_base_link            // given a rigid transform in 4x4 matrix
    ) {
    RCLCPP_INFO(node_->get_logger(), "Sending goal!");
    geometry_msgs::msg::PoseStamped goal_pose;

    goal_pose.header.frame_id = "base_link"; // everything in goal_pose is relative to the robot's base link
    goal_pose.header.stamp = node_->get_clock()->now();         

    goal_pose.pose.position.x = goal_pose_relative_to_base_link(0, 3);      // Grab the translational from last column of the 4x4
    goal_pose.pose.position.y = goal_pose_relative_to_base_link(1, 3);
    goal_pose.pose.position.z = goal_pose_relative_to_base_link(2, 3);

    const Eigen::Quaterniond quat(goal_pose_relative_to_base_link.block<3, 3>(0, 0));

    goal_pose.pose.orientation.x = quat.x();
    goal_pose.pose.orientation.y = quat.y();
    goal_pose.pose.orientation.z = quat.z();
    goal_pose.pose.orientation.w = quat.w();


    nav2_msgs::action::NavigateToPose::Goal goal_msg = nav2_msgs::action::NavigateToPose::Goal();       // Create the msg to send
    goal_msg.pose = goal_pose;                                                                          // Stuff the msg with the pose
    client_->async_send_goal(goal_msg, send_goal_options_);                                             // Send the msg
}