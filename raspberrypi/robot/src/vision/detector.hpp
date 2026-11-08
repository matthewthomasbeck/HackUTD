#pragma once

// IDetector: runs a model on one camera frame. The real one uses OpenCV to preprocess and the
// Coral USB Edge TPU to run a compiled TFLite model.
//
// It is also an IDevice named "coral": init() loads the model onto the TPU, which can take
// seconds, so it runs on the DeviceManager's init thread and never on the main or vision thread.

#include <memory>
#include <string>
#include <vector>

#include "hal/camera.hpp"
#include "hal/device.hpp"
#include "vision/detection.hpp"

namespace robot {

struct DetectorConfig {
  std::string model_path;   // vision.model_path, an Edge TPU compiled .tflite, TBD
  std::string labels_path;  // vision.labels_path, TBD
  float min_score = 0.5f;   // vision.min_score, TBD
};

class IDetector : public IDevice {
 public:
  virtual bool ready() const = 0;
  // Called only from the vision thread. May take tens of milliseconds.
  virtual std::vector<Detection> detect(const Frame& frame) = 0;
};

// OpenCV + Edge TPU. Stub until the model and runtime are chosen.
std::shared_ptr<IDetector> make_detector_coral(const DetectorConfig& config);
// Finds nothing; ready at once.
std::shared_ptr<IDetector> make_detector_mock();

}  // namespace robot
