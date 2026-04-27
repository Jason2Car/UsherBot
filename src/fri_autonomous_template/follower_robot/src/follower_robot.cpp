
#include <follower_robot/FollowerRobotNode.h>
#include <rclcpp/rclcpp.hpp>


int main(int argc, char **argv) {
    rclcpp::init(argc, argv);
    std::shared_ptr<FollowerRobotNode> node = std::make_shared<FollowerRobotNode>(-1.6, 2);
    RCLCPP_INFO(node->get_logger(), "Target set!");
    rclcpp::spin(node);
    rclcpp::shutdown();
    return 0;
}