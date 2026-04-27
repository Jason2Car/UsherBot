#include <spatial_utils/transform_util.h>

/*
    For this one.
        Make a 4x4 Identity matrix using Eigen::MatrixXd::Identity
        Set the right column to the translation, as in the class notes.
        Set the upper-left 3x3 to the rotation matrix.
        You can use Eigen::Quaterniond to turn the quaternion from the
            TransformStamped into a rotation matrix.
            Quaterniond, then .toRotationMatrix
        You can use .block to refer to to the upper-left 3x3 submatrix of your
            4x4 rigid transformation.
*/
// This looks good - Jason
Eigen::MatrixXd transformToMatrix(const geometry_msgs::msg::TransformStamped &transform) {
    Eigen::MatrixXd matrix = Eigen::MatrixXd::Identity(4,4);            // Created a 4x4 identity matirx

    matrix(0, 3) = transform.transform.translation.x;                   // Set's the rightmost column to translational component
    matrix(1, 3) = transform.transform.translation.y;
    matrix(2, 3) = transform.transform.translation.z;

    const Eigen::Quaterniond quat(                                      // Create a quaternion from the rotational component
        transform.transform.rotation.w,
        transform.transform.rotation.x,
        transform.transform.rotation.y,
        transform.transform.rotation.z
    );

    matrix.block(0, 0, 3, 3) = quat.toRotationMatrix();                 // Set the upper left 3x3 to rotation matrix from quaternion

    return matrix;
}

/*
    Converting your 4x4 rigid transformation into a TransformStamped works like
        this.
    Set the header.frame_id to the parent frame,
        and the child_frame_id to the child frame.
    Take the right column as transform.translation.
    Use block to get the 3x3 upper left rotation matrix from the
        rigid transformation.
    Stick that into Eigen::Quaterniond, then pull off the quaternion terms. 
        Put those into the terms of transform.rotation.
    
*/
geometry_msgs::msg::TransformStamped matrixToTransform(
    const Eigen::MatrixXd &matrix, const std::string &parent_frame, const std::string &child_frame) {
    
    // specifies how to get from parent frame to child frame
    geometry_msgs::msg::TransformStamped transform_msg;

    transform_msg.header.frame_id = parent_frame;
    transform_msg.child_frame_id = child_frame;
    transform_msg.header.stamp = rclcpp::Time(0, 0);                        // Added something to set time
    // printTransform("go_to", transform_msg);

    transform_msg.transform.translation.x = matrix(0, 3);
    transform_msg.transform.translation.y = matrix(1, 3);
    transform_msg.transform.translation.z = matrix(2, 3);
    // transform_msg.transform.translation.x = 0.1;
    // transform_msg.transform.translation.y = 0;
    // transform_msg.transform.translation.z = 0;

    const Eigen::Quaterniond quat(matrix.block<3, 3>(0, 0));
    transform_msg.transform.rotation.x = quat.x();
    transform_msg.transform.rotation.y = quat.y();
    transform_msg.transform.rotation.z = quat.z();
    transform_msg.transform.rotation.w = quat.w();
    // transform_msg.transform.rotation.x = 0;
    // transform_msg.transform.rotation.y = 0;
    // transform_msg.transform.rotation.z = 0;
    // transform_msg.transform.rotation.w = 1;

    return transform_msg;
}

void printTransform(const rclcpp::Logger &logger, geometry_msgs::msg::TransformStamped &transform) {
    RCLCPP_INFO_STREAM(logger,
        "Transform Received:\n" <<
        "  Timestamp: " << transform.header.stamp.sec << "." << transform.header.stamp.nanosec <<

        "  Parent Frame: " << transform.header.frame_id << "\n" <<
        "  Child Frame: " << transform.child_frame_id << "\n" <<
        "  Translation: [" << transform.transform.translation.x << ", "
                           << transform.transform.translation.y << ", "
                           << transform.transform.translation.z << "]\n" <<
        "  Rotation: [" << transform.transform.rotation.x << ", "
                        << transform.transform.rotation.y << ", "
                        << transform.transform.rotation.z << ", "
                        << transform.transform.rotation.w << "]"
    );
}