// Coral Edge TPU detector. Stub: init() reports FAILED until the model and runtime are set up.
//
// Toolchain risk to check first on the Pi (Debian 12, aarch64): the official pycoral wheels stop
// at Python 3.9 and Debian 12 ships 3.11, so use the C++ path: libedgetpu plus the TensorFlow
// Lite C++ runtime of the version libedgetpu was built against, and OpenCV for preprocessing.

#include "vision/detector.hpp"

namespace robot {

namespace {

class DetectorCoral : public IDetector {
 public:
  explicit DetectorCoral(DetectorConfig config) : config_(std::move(config)) {}

  std::string name() const override { return "coral"; }

  InitResult init() override {
    if (config_.model_path.empty()) return {DeviceStatus::FAILED, "vision.model_path is not set (TBD)"};
#if defined(ROBOT_WITH_CORAL) && defined(ROBOT_WITH_OPENCV)
    // TODO(vision): open the Edge TPU (edgetpu::EdgeTpuManager::GetSingleton()->OpenDevice()),
    // build a tflite::Interpreter from config_.model_path with the edgetpu custom op registered,
    // AllocateTensors(), read the input tensor shape, and load labels from config_.labels_path.
    return {DeviceStatus::FAILED, "Coral detector not written yet"};
#else
    return {DeviceStatus::FAILED, "built without OpenCV and the Edge TPU runtime"};
#endif
  }

  bool ready() const override { return false; }

  std::vector<Detection> detect(const Frame& frame) override {
    // TODO(vision): wrap frame.pixels in a cv::Mat (no copy), cv::resize to the model input size,
    // convert to the input type (uint8 for a quantized model), copy into the input tensor,
    // Invoke(), then read boxes, classes, and scores and keep those >= config_.min_score.
    (void)frame;
    return {};
  }

 private:
  DetectorConfig config_;
};

}  // namespace

std::shared_ptr<IDetector> make_detector_coral(const DetectorConfig& config) {
  return std::make_shared<DetectorCoral>(config);
}

}  // namespace robot
